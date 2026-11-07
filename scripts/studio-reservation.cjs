// Machine-local coordination, not an authorization boundary against local users.
// Never derive permission to stop Studio from a PID or an expired heartbeat.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const CLEANUP_FIELDS = [
	"editReady",
	"sessionStopped",
	"deviceRestored",
	"temporaryStateCleared",
	"syncStopped",
	"captureSaved",
	"sourceStable",
];
const DEFAULT_CLEANUP = CLEANUP_FIELDS.slice(0, 4);
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function required(value, name) {
	if (typeof value !== "string" || !value.trim() || value.length > 2048)
		throw Error(`${name} must be a nonempty string (maximum 2048 characters).`);
	return value;
}
function defaultDirectory() {
	return path.join(
		process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"),
		"RobloxStudioTools",
		"coordination",
	);
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function createCoordinator(options) {
	const projectId = required(options.projectId, "projectId");
	const studioId = required(options.studioId, "studioId");
	const directory = path.resolve(options.directory || defaultDirectory());
	const resource = path.join(directory, digest(studioId));
	const file = resource + ".json";
	const lock = resource + ".lock";
	const repair = resource + ".repair";
	const now = options.now || Date.now;
	const ttl = options.heartbeatMs || 600000;
	const timeout = options.lockTimeoutMs ?? 5000;
	if (!Number.isFinite(ttl) || ttl < 1000) throw Error("heartbeatMs must be at least 1000.");
	function read() {
		if (!fs.existsSync(file))
			return { schemaVersion: 1, studioId, revision: 0, sequence: 0, active: null, requests: [] };
		let state;
		try {
			state = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch {
			throw Error(`Reservation ledger is unreadable; recovery required: ${file}`);
		}
		if (
			state.schemaVersion !== 1 ||
			state.studioId !== studioId ||
			!Array.isArray(state.requests) ||
			!Number.isSafeInteger(state.revision)
		)
			throw Error("Invalid reservation ledger; recovery required.");
		return state;
	}
	function transaction(fn) {
		fs.mkdirSync(directory, { recursive: true });
		const started = Date.now();
		const nonce = crypto.randomUUID();
		for (;;) {
			try {
				if (fs.existsSync(repair))
					throw Object.assign(Error("Ledger mutex recovery in progress."), { code: "EEXIST" });
				fs.mkdirSync(lock);
				fs.writeFileSync(
					path.join(lock, "owner.json"),
					JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }),
				);
				if (fs.existsSync(repair)) {
					fs.rmSync(lock, { recursive: true });
					throw Object.assign(Error("Ledger mutex recovery in progress."), { code: "EEXIST" });
				}
				break;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
				if (Date.now() - started >= timeout)
					throw Error(
						`Reservation ledger is busy or its writer crashed. No takeover performed. Inspect/recover mutex: ${lock}`,
						{ cause: error },
					);
				pause(10);
			}
		}
		try {
			let state = read();
			// Persist ambiguity even when the attempted mutation is rejected. Cleanup
			// heartbeats must not silently turn an expired controller back into an editor.
			if (
				state.active?.phase === "active" &&
				(now() - Date.parse(state.active.heartbeatAt) > ttl ||
					(state.active.controllerPid && !alive(state.active.controllerPid)))
			) {
				state.active.phase = "recoveryRequired";
				state.active.recovery = {
					reason: "Controller heartbeat expired or controller process ended; verified recovery required.",
					markedAt: new Date(now()).toISOString(),
				};
			}
			const before = clone(state);
			let result, failure;
			try {
				result = fn(state);
			} catch (error) {
				failure = error;
				state = before;
			}
			state.revision++;
			const temporary = `${file}.${nonce}.tmp`;
			fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx" });
			// Same-volume rename publishes the entire ledger; a crash leaves either version.
			require("./atomic-replace.cjs").atomicReplace(temporary, file);
			if (failure) throw failure;
			return clone(result);
		} finally {
			const owner = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8"));
			if (owner.nonce !== nonce)
				// eslint-disable-next-line no-unsafe-finally -- An integrity failure must override apparent transaction success.
				throw Error("Reservation ledger mutex changed unexpectedly; recovery required.");
			fs.rmSync(lock, { recursive: true });
		}
	}
	function iso() {
		return new Date(now()).toISOString();
	}
	function owned(state, args, allowVerifying = false) {
		const active = state.active;
		if (!active || !args.token || active.token !== args.token || active.projectId !== projectId)
			throw Error("Studio reservation ownership mismatch.");
		if ((args.owner && active.owner !== args.owner) || (args.task && active.task !== args.task))
			throw Error("Studio reservation owner/task mismatch.");
		if (active.phase === "verifyingCleanup" && !allowVerifying && !args.cleanup)
			throw Error("Cleanup verification in progress; mutation refused.");
		const stale = now() - Date.parse(active.heartbeatAt) > ttl;
		const dead = active.controllerPid && !alive(active.controllerPid);
		if ((active.phase === "recoveryRequired" || stale || dead) && !args.cleanup)
			throw Error(
				"Reservation requires recovery; heartbeat expiry/dead process never transfers Studio ownership.",
			);
		return active;
	}
	function redacted(state) {
		const value = clone(state);
		if (value.active) {
			delete value.active.token;
			value.active.heartbeatExpired = now() - Date.parse(value.active.heartbeatAt) > ttl;
			value.active.controllerAlive = value.active.controllerPid ? alive(value.active.controllerPid) : null;
			if (value.active.heartbeatExpired || value.active.controllerAlive === false)
				value.active.recoveryRequired = true;
		}
		return value;
	}
	function request(args) {
		const fields = {
			requestId: required(args.requestId, "requestId"),
			projectId,
			owner: required(args.owner, "owner"),
			task: required(args.task, "task"),
			operation: required(args.operation, "operation"),
			checkout: path.resolve(required(args.checkout, "checkout")),
			sessionPath: args.sessionPath ? path.resolve(args.sessionPath) : null,
			evidencePath: args.evidencePath ? path.resolve(args.evidencePath) : null,
			sourceVersion: args.sourceVersion || null,
			requirements: [...new Set([...DEFAULT_CLEANUP, ...(args.requirements || [])])].sort(),
		};
		if (fields.requirements.some((key) => !CLEANUP_FIELDS.includes(key)))
			throw Error("Unknown cleanup requirement.");
		// Copy only the documented fields: environment, auth headers and arbitrary metadata are never recorded.
		const fingerprint = digest(JSON.stringify(fields));
		return transaction((state) => {
			const old = state.requests.find((item) => item.requestId === fields.requestId);
			if (old) {
				if (old.fingerprint !== fingerprint)
					throw Error(
						"Duplicate request ID has different ownership or operation fields. Use a new request ID.",
					);
				return old;
			}
			const entry = {
				...fields,
				fingerprint,
				sequence: ++state.sequence,
				requestedAt: iso(),
				status: "queued",
			};
			state.requests.push(entry);
			return entry;
		});
	}
	function acquire(args) {
		return transaction((state) => {
			const request = state.requests.find((item) => item.requestId === args.requestId);
			if (
				!request ||
				request.projectId !== projectId ||
				request.owner !== args.owner ||
				request.task !== args.task
			)
				throw Error("Queue request owner/task mismatch.");
			if (state.active?.requestId === request.requestId) {
				// Retries must possess the original token, not just guess a public request ID.
				owned(state, args);
				return state.active;
			}
			if (request.status !== "queued")
				throw Error(`Request is ${request.status}; create a new request ID to requeue.`);
			if (state.active)
				return { acquired: false, reason: "occupied", activeRequestId: state.active.requestId };
			const first = state.requests.find((item) => item.status === "queued");
			if (first !== request) return { acquired: false, reason: "queued", nextRequestId: first.requestId };
			if (
				args.controllerPid !== undefined &&
				(!Number.isInteger(args.controllerPid) || args.controllerPid < 1)
			)
				throw Error("Invalid controllerPid.");
			request.status = "active";
			state.active = {
				...request,
				token: crypto.randomUUID(),
				acquired: true,
				acquiredAt: iso(),
				heartbeatAt: iso(),
				acquiringPid: process.pid,
				controllerPid: args.controllerPid || null,
				phase: "active",
				operations: [],
				recovery: null,
			};
			return state.active;
		});
	}
	function assertOwnership(args) {
		return transaction((state) => owned(state, args));
	}
	function heartbeat(args) {
		return transaction((state) => {
			const active = owned(state, args);
			active.heartbeatAt = iso();
			return active;
		});
	}
	function beginOperation(args) {
		return transaction((state) => {
			const active = owned(state, args);
			const operation = required(args.operation, "operation");
			const operationId = args.operationId || crypto.randomUUID();
			const existing = active.operations.find((item) => item.operationId === operationId);
			if (existing) {
				if (existing.operation !== operation || existing.parentId !== (args.parentId || null))
					throw Error("Operation ID reused with different fields.");
				return existing;
			}
			if (args.parentId && !active.operations.some((item) => item.operationId === args.parentId))
				throw Error("Nested operation parent is not active.");
			const span = {
				operationId,
				operation,
				parentId: args.parentId || null,
				pid: process.pid,
				startedAt: iso(),
				cleanup: args.cleanup === true,
			};
			active.operations.push(span);
			active.heartbeatAt = iso();
			return span;
		});
	}
	function endOperation(args) {
		return transaction((state) => {
			const active = owned(state, { ...args, cleanup: true });
			const span = active.operations.find((item) => item.operationId === args.operationId);
			if (!span) throw Error("Operation does not belong to this reservation.");
			if (active.operations.some((item) => item.parentId === args.operationId))
				throw Error("Nested operation still active.");
			active.operations = active.operations.filter((item) => item !== span);
			active.heartbeatAt = iso();
			return { ended: args.operationId };
		});
	}
	function markRecovery(args) {
		return transaction((state) => {
			const active = owned(state, { ...args, cleanup: true });
			active.phase = "recoveryRequired";
			active.recovery = { reason: required(args.reason, "reason"), markedAt: iso() };
			return { recoveryRequired: true, requestId: active.requestId };
		});
	}
	function cancel(args) {
		return transaction((state) => {
			const request = state.requests.find((item) => item.requestId === args.requestId);
			if (
				!request ||
				request.projectId !== projectId ||
				request.owner !== args.owner ||
				request.task !== args.task
			)
				throw Error("Queue request owner/task mismatch.");
			if (request.status === "cancelled") return request;
			if (request.status !== "queued")
				throw Error("Only queued requests can be cancelled. Active ownership requires verified release.");
			request.status = "cancelled";
			request.cancelledAt = iso();
			return request;
		});
	}
	async function finish(args, verifier, recovery) {
		if (typeof verifier !== "function")
			throw Error("Release requires a trusted live cleanup verifier; boolean flags/files are not proof.");
		const verificationId = crypto.randomUUID();
		const active = transaction((state) => {
			const current = owned(state, { ...args, cleanup: recovery }, recovery);
			if (
				current.phase === "verifyingCleanup" &&
				(!current.verificationPid || alive(current.verificationPid))
			)
				throw Error("Cleanup verifier is alive or ambiguous; wait for its operation to finish.");
			if (
				recovery &&
				current.controllerPid &&
				current.controllerPid !== process.pid &&
				alive(current.controllerPid)
			)
				throw Error("Another reservation controller is still alive; recovery cannot adopt its operation.");
			if (
				recovery &&
				current.operations.some(
					(item) =>
						item.pid !== process.pid && (!Number.isInteger(item.pid) || item.pid < 1 || alive(item.pid)),
				)
			)
				throw Error(
					"Another operation process is alive or ambiguous; recovery cannot release its reservation.",
				);
			if (!recovery && current.operations.length)
				throw Error("Operations are still active; complete their cleanup before release.");
			current.phase = "verifyingCleanup";
			current.verificationId = verificationId;
			current.verificationPid = process.pid;
			return current;
		});
		try {
			const proof = await verifier(clone(active));
			return transaction((state) => {
				const current = owned(state, { ...args, cleanup: true }, true);
				if (current.verificationId !== verificationId) throw Error("Cleanup verifier was superseded.");
				if (!proof || proof.studioId !== studioId || proof.projectId !== projectId)
					throw Error("Cleanup proof has wrong Studio/project identity.");
				if (
					!Number.isFinite(Date.parse(proof.observedAt)) ||
					Date.parse(proof.observedAt) < Date.parse(active.acquiredAt) ||
					Math.abs(now() - Date.parse(proof.observedAt)) > 30000
				)
					throw Error("Cleanup evidence is stale or missing its observation time.");
				required(proof.evidencePath, "cleanup evidencePath");
				for (const key of current.requirements)
					if (proof[key] !== true) throw Error(`Cleanup verification failed: ${key}.`);
				if (!recovery && current.operations.length) throw Error("Cleanup verifier left active operations.");
				if (
					recovery &&
					current.operations.some(
						(item) => !active.operations.some((old) => old.operationId === item.operationId),
					)
				)
					throw Error("Recovery verifier left new active operations.");
				if (recovery && current.operations.length && proof.orphanOperationsResolved !== true)
					throw Error("Orphan operations remain unresolved.");
				const request = state.requests.find((item) => item.requestId === current.requestId);
				request.status = "released";
				request.releasedAt = iso();
				request.cleanup = Object.fromEntries(
					["observedAt", "evidencePath", ...CLEANUP_FIELDS, "orphanOperationsResolved"]
						.filter((key) => proof[key] !== undefined)
						.map((key) => [key, proof[key]]),
				);
				state.active = null;
				return { released: true, requestId: request.requestId, cleanup: request.cleanup };
			});
		} catch (error) {
			transaction((state) => {
				const current = owned(state, { ...args, cleanup: true }, true);
				if (current.verificationId === verificationId) {
					current.phase = "recoveryRequired";
					current.recovery = {
						reason: "Cleanup verification failed or was interrupted; inspect evidence before recovery.",
						markedAt: iso(),
					};
					delete current.verificationId;
				}
				return { recoveryRequired: true };
			});
			throw error;
		}
	}
	function recoverMutex() {
		fs.mkdirSync(directory, { recursive: true });
		try {
			fs.mkdirSync(repair);
		} catch {
			throw Error("Another mutex recovery is active; inspect it before proceeding.");
		}
		try {
			if (!fs.existsSync(lock)) return { repaired: false, reason: "no-lock" };
			let writer;
			try {
				writer = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8"));
			} catch {
				throw Error("Unknown mutex writer. Manual investigation required; lock retained.");
			}
			if (!Number.isInteger(writer.pid) || writer.pid < 1 || alive(writer.pid))
				throw Error("Ledger writer is alive or ambiguous; lock retained.");
			// This only repairs the short ledger writer mutex, never the Studio reservation.
			fs.rmSync(lock, { recursive: true });
			read();
			return { repaired: true, reservationUnchanged: true };
		} finally {
			fs.rmdirSync(repair);
		}
	}
	return {
		projectId,
		studioId,
		directory,
		file,
		inspect: () => transaction((state) => redacted(state)),
		request,
		acquire,
		cancel,
		assertOwnership,
		heartbeat,
		beginOperation,
		endOperation,
		markRecovery,
		release: (args, verifier) => finish(args, verifier, false),
		recover: (args, verifier) => finish(args, verifier, true),
		recoverMutex,
	};
}

function contextFromEnvironment(root = path.resolve(__dirname, "..")) {
	const checkout = path.resolve(root);
	const config = require("./studio-config.cjs").read(checkout);
	const projectId = required(String(config.expectedPlaceId || ""), "configured expectedPlaceId");
	if (process.env.STUDIO_RESERVATION_PROJECT && process.env.STUDIO_RESERVATION_PROJECT !== projectId)
		throw Error("STUDIO_RESERVATION_PROJECT does not match the checkout configured expectedPlaceId.");
	const studioId = required(process.env.STUDIO_RESERVATION_STUDIO, "STUDIO_RESERVATION_STUDIO");
	return {
		checkout,
		projectId,
		studioId,
		token: required(process.env.STUDIO_RESERVATION_TOKEN, "STUDIO_RESERVATION_TOKEN"),
		owner: required(process.env.STUDIO_RESERVATION_OWNER, "STUDIO_RESERVATION_OWNER"),
		task: required(process.env.STUDIO_RESERVATION_TASK, "STUDIO_RESERVATION_TASK"),
		coordinator: createCoordinator({ projectId, studioId }),
	};
}

async function main(argv = process.argv.slice(2), hooks = {}) {
	const command = argv.shift();
	if (!command || command === "--help") {
		console.log(
			"studio-reservation <inspect|request|acquire|cancel|heartbeat|release|recover|recover-mutex> --studio ID --project PLACE --owner NAME --task TASK --request ID [--operation TYPE --checkout PATH --session PATH --evidence PATH --source REV]\nToken comes from STUDIO_RESERVATION_TOKEN. Release/recover require the studio-turn live verifier, not an assertion flag.",
		);
		return;
	}
	const args = {};
	while (argv.length) {
		const key = argv.shift();
		if (!/^--[a-z-]+$/.test(key) || !argv.length) throw Error(`Invalid option ${key}`);
		args[key.slice(2)] = argv.shift();
	}
	const coordinator = createCoordinator({
		studioId: args.studio || process.env.STUDIO_RESERVATION_STUDIO,
		projectId: args.project || process.env.STUDIO_RESERVATION_PROJECT,
	});
	const identity = {
		requestId: args.request,
		owner: args.owner || process.env.STUDIO_RESERVATION_OWNER,
		task: args.task || process.env.STUDIO_RESERVATION_TASK,
		token: process.env.STUDIO_RESERVATION_TOKEN,
	};
	let result;
	if (command === "inspect") result = coordinator.inspect();
	else if (command === "request")
		result = coordinator.request({
			...identity,
			operation: args.operation,
			checkout: args.checkout || process.cwd(),
			sessionPath: args.session,
			evidencePath: args.evidence,
			sourceVersion: args.source,
		});
	else if (command === "acquire") result = coordinator.acquire(identity);
	else if (command === "cancel") result = coordinator.cancel(identity);
	else if (command === "heartbeat") {
		const value = coordinator.heartbeat(identity);
		result = { heartbeatAt: value.heartbeatAt, requestId: value.requestId };
	} else if (command === "recover-mutex") result = coordinator.recoverMutex();
	else if (command === "release" || command === "recover")
		result = await coordinator[command](identity, hooks.verifyCleanup);
	else throw Error(`Unknown command ${command}`);
	console.log(JSON.stringify(result, null, 2));
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = {
	createCoordinator,
	contextFromEnvironment,
	defaultDirectory,
	main,
	CLEANUP_FIELDS,
	DEFAULT_CLEANUP,
};
