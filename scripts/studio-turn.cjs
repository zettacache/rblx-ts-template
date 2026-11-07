#!/usr/bin/env node
// A bounded, reviewed operation, including cleanup, under the shared queue.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { waitForContext, mode } = require("./studio-state.cjs");
const device = require("./studio-device.cjs");
const { decodeResult } = require("./studio-result.cjs");
const ROOT = path.resolve(__dirname, "..");
const write = (file, value) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
function sourceVersion(root = ROOT) {
	const state = require("./tooling-snapshot.cjs").snapshot(root);
	return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
function readPlan(file) {
	const plan = JSON.parse(require("./text-files.cjs").readText(file));
	if (
		!plan.operation ||
		!Array.isArray(plan.command) ||
		!plan.command.length ||
		plan.command.some((v) => typeof v !== "string")
	)
		throw Error("Plan needs operation and command argv array.");
	if (!plan.cleanupProbe)
		throw Error(
			"Plan needs a reviewed cleanupProbe Luau file returning {robloxStudio=1,ok=true,clean=true}.",
		);
	plan.cleanupProbe = path.resolve(path.dirname(file), plan.cleanupProbe);
	plan.cleanupSource = require("./text-files.cjs").readText(plan.cleanupProbe);
	plan.digest = crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
	return plan;
}
function childCommand(argv, root, env, record) {
	return new Promise((resolve, reject) => {
		const held = record ? require("./studio-guard.cjs").begin(root, record.studioId, "turn-command") : null;
		const child = spawn(argv[0] === "node" ? process.execPath : argv[0], argv.slice(1), {
			cwd: root,
			env,
			stdio: "inherit",
			windowsHide: true,
			shell: false,
		});
		if (record)
			write(record.file, {
				...JSON.parse(fs.readFileSync(record.file)),
				childPid: child.pid || null,
				commandState: "running",
				commandOperationId: held.span.operationId,
			});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			try {
				if (record) {
					write(record.file, {
						...JSON.parse(fs.readFileSync(record.file)),
						commandState: "exited",
						childExitCode: code,
						childSignal: signal,
					});
					require("./studio-guard.cjs").end(held.ctx, held.span);
				}
				code === 0 ? resolve() : reject(Error(`Turn command failed (${code ?? signal}).`));
			} catch (error) {
				reject(error);
			}
		});
	});
}
function assertDead(pid, label) {
	if (!Number.isInteger(pid) || pid < 1) throw Error(`${label} identity is missing; recovery is ambiguous.`);
	try {
		process.kill(pid, 0);
	} catch (error) {
		if (error.code === "ESRCH") return;
		throw error;
	}
	throw Error(`${label} is alive or its PID was reused; recovery refused.`);
}
function activate(record) {
	for (const [key, value] of Object.entries({
		TOKEN: record.token,
		OWNER: record.owner,
		TASK: record.task,
		STUDIO: record.studioId,
		PROJECT: record.projectId,
	}))
		process.env["STUDIO_RESERVATION_" + key] = value;
	process.env.STUDIO_TURN_RECORD = record.file;
}
function registerSession(file) {
	const recordFile = process.env.STUDIO_TURN_RECORD;
	if (!recordFile) return;
	const record = JSON.parse(fs.readFileSync(recordFile));
	if (record.token !== process.env.STUDIO_RESERVATION_TOKEN) throw Error("Turn/session ownership mismatch.");
	record.sessions = [...new Set([...(record.sessions || []), path.resolve(file)])];
	write(recordFile, record);
}
async function cleanupSessions(client, studio, sessions) {
	for (const file of sessions) {
		if (!fs.existsSync(file)) continue; // Registered before start; no session means start never happened.
		const session = JSON.parse(fs.readFileSync(file));
		const current = mode(await client.call("get_studio_state", { studio_id: studio.id }));
		if (current === "Play") {
			if (session.status !== "running")
				throw Error("Unconfirmed play session: retained for manual marker investigation; never adopted.");
			await require(
				session.transport === "StudioTestService" ? "./studio-native-play.cjs" : "./studio-play.cjs",
			).lifecycle(client, studio, "stop", file);
		} else if (session.transport === "StudioTestService" && session.status === "running") {
			// Lost EndTest acknowledgements can leave a running local record in Edit.
			// Only the matching completed native callback can establish this stop.
			await require("./studio-native-play.cjs").lifecycle(client, studio, "stop", file);
		} else if (session.status !== "stopped") {
			throw Error("Session was not confirmed stopped by its owner; investigate before recovery.");
		}
	}
}
async function cleanup(client, studio, record, plan) {
	process.env.STUDIO_RESERVATION_CLEANUP = "1";
	// Only existing marker-verified session ownership may stop a running test.
	const latest = JSON.parse(fs.readFileSync(record.file));
	if (latest.commandState === "running") assertDead(latest.childPid, "Turn child process");
	const project = JSON.parse(fs.readFileSync(path.join(ROOT, "default.project.json")));
	if (await require("./port-listener.cjs").listening(project.servePort || 34872))
		throw Error("Rojo is still listening; original owner must stop it before release.");
	await cleanupSessions(client, studio, latest.sessions || []);
	await waitForContext(client, studio, "Edit");
	if (!record.device) throw Error("No original device snapshot; recovery requires investigation.");
	const actual = await device.snapshot(client, studio);
	if (!require("node:util").isDeepStrictEqual(actual, record.device))
		await device.restore(client, studio, record.device);
	const restored = await device.snapshot(client, studio);
	if (!require("node:util").isDeepStrictEqual(restored, record.device))
		throw Error("Original device settings were not restored.");
	const probe = decodeResult(
		await client.call("execute_luau", {
			studio_id: studio.id,
			datamodel_type: "Edit",
			code: plan.cleanupSource,
		}),
	);
	if (probe.clean !== true) throw Error("Operation-specific cleanup probe did not confirm cleanup.");
	if (plan.sourceStable !== false && sourceVersion() !== record.sourceVersion)
		throw Error("Source changed during the turn; acceptance invalid, inspect before release.");
	const proof = {
		studioId: studio.id,
		projectId: record.projectId,
		observedAt: new Date().toISOString(),
		evidencePath: record.file,
		editReady: true,
		sessionStopped: true,
		deviceRestored: true,
		temporaryStateCleared: true,
		sourceStable: plan.sourceStable === false ? undefined : true,
		syncStopped: true,
		orphanOperationsResolved: true,
	};
	write(record.file, { ...latest, cleanup: proof, deviceAfter: restored });
	return proof;
}
async function finishOwnedTurn(coordinator, token, verifier, recovery = false) {
	// A rejected/ambiguous child tool has already retained an operation span.
	// Recover with the same owner and full live verifier; never release on faith.
	const needsRecovery = recovery || coordinator.inspect().active?.phase === "recoveryRequired";
	return needsRecovery ? coordinator.recover({ token }, verifier) : coordinator.release({ token }, verifier);
}
async function run(file, options) {
	const plan = readPlan(file);
	const configuredPlaceId = require("./studio-config.cjs").read().expectedPlaceId;
	if (
		configuredPlaceId === null ||
		configuredPlaceId === undefined ||
		!/^(0|[1-9]\d*)$/.test(String(configuredPlaceId))
	)
		throw Error("Configure studio-tools.json expectedPlaceId before requesting a Studio turn.");
	const projectId = String(configuredPlaceId);
	const { createCoordinator } = require("./studio-reservation.cjs");
	const coordinator = createCoordinator({ projectId, studioId: options.studio });
	const requestId = options.request;
	if (!requestId || !options.owner || !options.task || !options.studio)
		throw Error("Use --request ID --owner ID --task ID --studio ID.");
	if (options.action === "request") {
		return coordinator.request({
			requestId,
			owner: options.owner,
			task: options.task,
			operation: plan.operation,
			checkout: ROOT,
			evidencePath: path.join(ROOT, "build", "turns", requestId + ".json"),
			sourceVersion: sourceVersion() + ":" + plan.digest,
			requirements: ["syncStopped"],
		});
	}
	let record;
	if (options.action === "recover") {
		if (!options.record) throw Error("Recovery needs --record <original turn.json>.");
		record = JSON.parse(fs.readFileSync(path.resolve(options.record)));
		if (
			record.planDigest !== plan.digest ||
			record.owner !== options.owner ||
			record.task !== options.task ||
			record.studioId !== options.studio ||
			record.projectId !== projectId
		)
			throw Error("Recovery identity/plan mismatch.");
		assertDead(record.controllerPid, "Original turn controller");
		if (record.commandState === "running") assertDead(record.childPid, "Turn child process");
	} else {
		const queued = coordinator.inspect().requests.find((item) => item.requestId === requestId);
		if (
			!queued ||
			!require("./path-identity.cjs").samePath(queued.checkout, ROOT) ||
			queued.operation !== plan.operation ||
			queued.sourceVersion !== sourceVersion() + ":" + plan.digest
		)
			throw Error("Queued checkout, source, or plan changed. Cancel and requeue the reviewed turn.");
		const project = JSON.parse(fs.readFileSync(path.join(ROOT, "default.project.json")));
		if (await require("./port-listener.cjs").listening(project.servePort || 34872))
			throw Error("Stop the Rojo listener before acquiring an authoring/test turn.");
		const acquired = coordinator.acquire({
			requestId,
			owner: options.owner,
			task: options.task,
			controllerPid: process.pid,
		});
		if (!acquired.token) throw Error("Reservation not acquired; remain queued and continue offline work.");
		record = {
			file: path.join(ROOT, "build", "turns", crypto.randomUUID() + ".json"),
			token: acquired.token,
			owner: options.owner,
			task: options.task,
			studioId: options.studio,
			projectId,
			requestId,
			checkout: ROOT,
			controllerPid: process.pid,
			planDigest: plan.digest,
			sourceVersion: sourceVersion(),
			sessions: [],
			startedAt: new Date().toISOString(),
		};
		write(record.file, record);
	}
	record.tracePath ||= record.file.replace(/\.json$/, ".timings.jsonl");
	write(record.file, record);
	activate(record);
	if (options.action === "recover") process.env.STUDIO_RESERVATION_CLEANUP = "1";
	const client = new McpClient(findBridge(), ["--stdio"], 30000, { tracePath: record.tracePath });
	const heartbeat = setInterval(() => {
		try {
			coordinator.heartbeat({ token: record.token });
		} catch {
			/* ownership checks still fail closed */
		}
	}, 10000);
	let failure;
	try {
		await client.connect();
		const studio = chooseStudio(await client.call("list_roblox_studios"), options.studio, projectId);
		if (
			!new RegExp(`placeId:\\s*${projectId}\\b`).test(studio.name || "") &&
			String(studio.placeId) !== projectId
		)
			throw Error("Studio does not match configured place.");
		if (options.action !== "recover") {
			await waitForContext(client, studio, "Edit");
			record.device = await device.snapshot(client, studio);
			write(record.file, record);
			try {
				await childCommand(
					plan.command,
					ROOT,
					{ ...process.env, STUDIO_MCP_TRACE: record.tracePath },
					record,
				);
			} catch (error) {
				failure = error;
			}
		}
		const verifier = () => cleanup(client, studio, record, plan);
		await finishOwnedTurn(coordinator, record.token, verifier, options.action === "recover");
		write(record.file, {
			...JSON.parse(fs.readFileSync(record.file)),
			released: true,
			releasedAt: new Date().toISOString(),
		});
		process.stdout.write(
			JSON.stringify({ released: true, evidence: record.file, commandPassed: !failure }) + "\n",
		);
		if (failure) throw failure;
		return { released: true, evidence: record.file };
	} catch (error) {
		try {
			coordinator.markRecovery({
				token: record.token,
				reason: "Turn failed; inspect local evidence and verify cleanup.",
			});
		} catch {
			/* already released */
		}
		throw error;
	} finally {
		clearInterval(heartbeat);
		client.close();
	}
}
async function main(argv = process.argv.slice(2)) {
	if (!argv.length || argv.includes("--help"))
		return console.log(
			"studio-turn request|run|recover <plan.json> --studio ID --request ID --owner ID --task ID [--record original.json]\nRequest is idempotent; run acquires only the queue head, verifies Edit/device state, runs argv without shell, verifies cleanup, then releases. Recover never adopts another test.",
		);
	const [action, file, ...args] = argv;
	if (!["request", "run", "recover"].includes(action)) throw Error("Unknown turn action.");
	const options = { action };
	for (let i = 0; i < args.length; i += 2) {
		if (!["--studio", "--request", "--owner", "--task", "--record"].includes(args[i]) || !args[i + 1])
			throw Error("Invalid turn option.");
		options[args[i].slice(2)] = args[i + 1];
	}
	console.log(JSON.stringify(await run(path.resolve(file), options)));
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = {
	sourceVersion,
	readPlan,
	registerSession,
	childCommand,
	cleanupSessions,
	cleanup,
	finishOwnedTurn,
	run,
	assertDead,
};
