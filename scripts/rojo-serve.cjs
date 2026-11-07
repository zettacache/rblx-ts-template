// A shared Studio may only sync the reviewed checkout under its active reservation.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

function canonical(value) {
	const real = fs.realpathSync.native(path.resolve(value));
	return process.platform === "win32" ? real.toLowerCase() : real;
}
function listening(port) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host: "127.0.0.1", port });
		socket.setTimeout(1500);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			reject(Error("Port check timed out; no Rojo server was started."));
		});
		socket.once("error", (error) => {
			socket.destroy();
			error.code === "ECONNREFUSED" ? resolve(false) : reject(error);
		});
	});
}

function integrationCheckout(root) {
	// The caller's reviewed checkout is authoritative; never infer a different worktree.
	return canonical(root);
}
function pathsFor(port, directory) {
	const dir =
		directory ||
		path.join(
			process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "state"),
			"RobloxStudioTools",
			"rojo",
		);
	fs.mkdirSync(dir, { recursive: true });
	return { lock: path.join(dir, `port-${port}.startup`), record: path.join(dir, `port-${port}.json`) };
}
function acquire(file) {
	try {
		fs.mkdirSync(file);
		return true;
	} catch (error) {
		if (error.code === "EEXIST") return false;
		throw error;
	}
}
function writeRecord(file, record) {
	const temp = `${file}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(record, null, 2));
	fs.renameSync(temp, file);
}
function readRecord(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw Error(`Unusable Rojo ownership record ${file}: ${error.message}`, { cause: error });
	}
}
// PID alone is insufficient: CreationDate fences PID reuse. Only inspect process metadata,
// never command lines or environment variables (which can contain credentials).
async function inspectListener(port) {
	if (process.platform !== "win32")
		throw Error("Listener identity inspection requires Windows. Unknown listeners are never reused.");
	const script = `$ErrorActionPreference='Stop'; $owners=@(Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if($owners.Count -ne 1){throw 'Expected exactly one listener owner'}; $all=@(Get-CimInstance Win32_Process); $current=$owners[0]; $chain=@(); for($i=0;$i -lt 16 -and $current -gt 0;$i++){ $item=$all | Where-Object ProcessId -eq $current | Select-Object -First 1; if(-not $item){break}; $chain+=@{pid=[int]$item.ProcessId; parentId=[int]$item.ParentProcessId; created=$item.CreationDate.ToUniversalTime().ToString('o')}; $current=$item.ParentProcessId }; ConvertTo-Json -InputObject @($chain) -Compress`;
	const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
		windowsHide: true,
		timeout: 10000,
		maxBuffer: 256 * 1024,
	});
	const chain = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
	if (!Array.isArray(chain) || !chain.length || !chain[0].created)
		throw Error("Listener process identity unavailable.");
	return { ...chain[0], ancestors: chain.slice(1) };
}
function sameListener(record, actual) {
	return record?.listener?.pid === actual.pid && record.listener.created === actual.created;
}
function belongsToChild(actual, childPid, startedAt) {
	return [actual, ...(actual.ancestors || [])].some(
		(item) => item.pid === childPid && Date.parse(item.created) >= Date.parse(startedAt) - 2000,
	);
}
function verifyRecord(record, identity, actual) {
	if (!record || record.state !== "ready" || !sameListener(record, actual))
		throw Error(
			"Unknown or replaced listener on the Rojo port; verify its owner and stop it through its original terminal before retrying.",
		);
	for (const field of ["root", "projectHash", "studioId", "projectId"]) {
		if (record[field] !== identity[field])
			throw Error(
				`Rojo listener ${field} mismatch: serving ${record.root}; requested ${identity.root}. Use the reviewed checkout and original reservation.`,
			);
	}
	if (record.reservationToken !== identity.reservationToken)
		throw Error("Rojo belongs to a different Studio reservation; only its original owner may control it.");
	return record;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ensure(options = {}) {
	if (process.platform !== "win32" && !options.inspectListener)
		throw Error("Native listener identity is unsupported on this platform; no Rojo process was started.");
	const root = canonical(options.root || path.resolve(__dirname, ".."));
	const integration = options.integrationRoot
		? canonical(options.integrationRoot)
		: integrationCheckout(root);
	if (root !== integration)
		throw Error(
			`Worker checkout cannot serve shared Studio. Build offline here; run serve:owned from reviewed checkout ${integration}.`,
		);
	const projectBytes = fs.readFileSync(path.join(root, "default.project.json"));
	const project = JSON.parse(projectBytes);
	const port = project.servePort || 34872;
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid Rojo servePort.");
	const ctx = options.context || require("./studio-guard.cjs").context(root);
	const owner = { token: ctx.token, owner: ctx.owner, task: ctx.task };
	const check = (cleanup = false) => {
		const reservation = ctx.coordinator.assertOwnership({ ...owner, cleanup });
		if (!reservation.checkout || canonical(reservation.checkout) !== root)
			throw Error(
				"Studio reservation belongs to a different checkout; acquire the reviewed checkout reservation before serving.",
			);
		return reservation;
	};
	check();
	const identity = {
		root,
		projectHash: crypto.createHash("sha256").update(projectBytes).digest("hex"),
		studioId: ctx.studioId,
		projectId: ctx.projectId,
		reservationToken: ctx.token,
	};
	const probe = options.probe || listening;
	const inspect = options.inspectListener || inspectListener;
	const start = options.spawn || spawn;
	const paths = pathsFor(port, options.directory);
	const verify = async () => {
		check();
		const record = verifyRecord(readRecord(paths.record), identity, await inspect(port));
		// Mapping must remain the one reviewed at startup; source edits are intentionally
		// streamed by Rojo and therefore forbidden during a stable test by the coordinator.
		if (
			crypto
				.createHash("sha256")
				.update(fs.readFileSync(path.join(root, "default.project.json")))
				.digest("hex") !== identity.projectHash
		)
			throw Error("Rojo mapping changed while serving; stop through its owner and review before restarting.");
		return record;
	};
	if (await probe(port)) {
		await verify();
		return { reused: true, port, verify };
	}
	if (!acquire(paths.lock))
		throw Error(
			`Rojo startup is in progress or interrupted (${paths.lock}). Retry after the owner finishes; a stale lock requires manual identity review, never automatic takeover.`,
		);
	let span;
	let child;
	let record;
	let owned = false;
	const unlock = () => fs.rmdirSync(paths.lock);
	try {
		if (await probe(port)) {
			await verify();
			return { reused: true, port, verify };
		}
		const previous = readRecord(paths.record);
		if (previous && !["stopped", "failed-before-spawn"].includes(previous.state))
			throw Error(
				`Previous Rojo operation is unresolved (${paths.record}). Recover its Studio reservation and process state before starting another server.`,
			);
		check();
		span = ctx.coordinator.beginOperation({ ...owner, operation: "rojo-sync" });
		record = {
			version: 1,
			...identity,
			state: "starting",
			port,
			launcherPid: process.pid,
			operationId: span.operationId,
			startedAt: new Date().toISOString(),
		};
		writeRecord(paths.record, record);
		child = start(options.executable || "rojo", ["serve", "default.project.json"], {
			cwd: root,
			windowsHide: true,
			stdio: "inherit",
		});
		owned = true;
		record.childPid = child.pid;
		writeRecord(paths.record, record);
		let settle;
		const completion = new Promise((resolve) => {
			settle = resolve;
		});
		let settled = false;
		const finish = async (error) => {
			if (settled) return;
			settled = true;
			try {
				// Child exit alone is insufficient: a shim's descendant might still serve.
				if (await probe(port))
					throw Error("Rojo child ended but port is still occupied; cleanup remains ambiguous.");
				check(true);
				ctx.coordinator.endOperation({ ...owner, operationId: span.operationId });
				record = { ...record, state: "stopped", stoppedAt: new Date().toISOString(), error: error?.message };
				writeRecord(paths.record, record);
				settle({ clean: true, error: error?.message });
			} catch (cleanupError) {
				record = { ...record, state: "recovery-required", error: cleanupError.message };
				writeRecord(paths.record, record);
				try {
					ctx.coordinator.markRecovery({ ...owner, reason: cleanupError.message });
				} catch {}
				settle({ clean: false, error: cleanupError.message });
			}
		};
		child.once("exit", (code) => {
			void finish(code ? Error(`Rojo exited with code ${code}`) : null);
		});
		child.once("error", (error) => {
			void finish(error);
		});
		const deadline = Date.now() + (options.startupTimeoutMs || 15000);
		while (Date.now() < deadline && !settled) {
			check();
			if (await probe(port)) {
				const actual = await inspect(port);
				if (!belongsToChild(actual, child.pid, record.startedAt))
					throw Error(
						"Listener appeared during startup but is not the launched Rojo process. No unrelated process was stopped.",
					);
				if (settled) throw Error("Rojo exited while verifying startup.");
				record = { ...record, state: "ready", listener: { pid: actual.pid, created: actual.created } };
				writeRecord(paths.record, record);
				const stop = async () => {
					if (settled) return completion;
					check(true);
					// This ChildProcess handle belongs to this launcher, never a reused listener.
					child.kill("SIGTERM");
					return completion;
				};
				return { reused: false, port, child, completion, verify, stop };
			}
			await delay(options.pollMs || 100);
		}
		throw Error(
			"Rojo did not establish a verified listener; original owner must inspect process and reservation recovery.",
		);
	} catch (error) {
		if (span && !owned) {
			ctx.coordinator.endOperation({ ...owner, operationId: span.operationId });
			if (record)
				writeRecord(paths.record, { ...record, state: "failed-before-spawn", error: error.message });
		} else if (owned) {
			writeRecord(paths.record, { ...record, state: "recovery-required", error: error.message });
			try {
				ctx.coordinator.markRecovery({ ...owner, reason: error.message });
			} catch {}
		}
		throw error;
	} finally {
		unlock();
	}
}
async function main() {
	if (process.argv.includes("--help"))
		return console.log(
			"Owned Rojo: npm run serve:owned [--monitor], inside a matching configured Studio reservation. Uses pinned executable discovery. Unknown listeners are refused; native identity inspection currently requires Windows.",
		);
	if (process.argv.slice(2).some((value) => value !== "--monitor")) throw Error("Unknown owned Rojo option.");
	const { toolPath } = await import("./lib.mjs");
	const result = await ensure({ executable: toolPath("rojo") });
	console.log(
		result.reused
			? `Verified existing Rojo on ${result.port}; it remains owned by its original launcher.`
			: `Serving reviewed checkout on ${result.port} under the Studio reservation.`,
	);
	if (result.reused && !process.argv.includes("--monitor")) return;
	const timer = setInterval(async () => {
		try {
			if (!(await listening(result.port))) throw Error("Rojo listener stopped.");
			await result.verify();
		} catch (error) {
			clearInterval(timer);
			console.error(error.message);
			process.exitCode = 1;
		}
	}, 3000);
	if (!result.reused) {
		const stopOwned = () => {
			result.stop().catch((error) => {
				console.error(error.message);
				process.exitCode = 1;
			});
		};
		process.once("SIGINT", stopOwned);
		process.once("SIGTERM", stopOwned);
		const cleanup = await result.completion;
		process.removeListener("SIGINT", stopOwned);
		process.removeListener("SIGTERM", stopOwned);
		clearInterval(timer);
		if (!cleanup.clean || cleanup.error) {
			console.error(cleanup.error);
			process.exitCode = 1;
		}
	}
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = {
	listening,
	acquire,
	ensure,
	integrationCheckout,
	inspectListener,
	sameListener,
	belongsToChild,
	pathsFor,
};
