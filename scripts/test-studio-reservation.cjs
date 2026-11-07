// Isolated test process: fictitious place, never a live upload target.
const injectedConfig = require("./studio-config.cjs");
const originalReadConfig = injectedConfig.read;
injectedConfig.read = (root) =>
	!root || require("node:path").resolve(root) === require("node:path").resolve(__dirname, "..")
		? { expectedPlaceId: "123456789" }
		: originalReadConfig(root);
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createCoordinator, contextFromEnvironment } = require("./studio-reservation.cjs");

function fixture(t, options = {}) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roblox-reservations-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const settings = { directory, studioId: "studio-instance-A", projectId: "place-123", ...options };
	return { directory, settings, coordinator: createCoordinator(settings) };
}
function request(coordinator, id, extras = {}) {
	return coordinator.request({
		requestId: id,
		owner: id,
		task: `task-${id}`,
		operation: "playtest",
		checkout: path.join(os.tmpdir(), id),
		sessionPath: path.join(os.tmpdir(), `${id}.session.json`),
		evidencePath: path.join(os.tmpdir(), `${id}.evidence.json`),
		...extras,
	});
}
function acquire(coordinator, id, extra = {}) {
	return coordinator.acquire({ requestId: id, owner: id, task: `task-${id}`, ...extra });
}
function proof(coordinator, extra = {}) {
	return {
		studioId: coordinator.studioId,
		projectId: coordinator.projectId,
		observedAt: new Date().toISOString(),
		evidencePath: "/verified/cleanup.json",
		editReady: true,
		sessionStopped: true,
		deviceRestored: true,
		temporaryStateCleared: true,
		...extra,
	};
}
function child(script, settings, args = []) {
	return new Promise((resolve, reject) => {
		const process = spawn(global.process.execPath, ["-e", script, JSON.stringify(settings), ...args], {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let out = "",
			err = "";
		process.stdout.on("data", (value) => {
			out += value;
		});
		process.stderr.on("data", (value) => {
			err += value;
		});
		process.on("error", reject);
		process.on("close", (code) =>
			code ? reject(Error(err || `child failed ${code}`)) : resolve(JSON.parse(out)),
		);
	});
}
const moduleName = JSON.stringify(path.join(__dirname, "studio-reservation.cjs"));

test("real processes and distinct worktree/session identities race for one global Studio slot", async (t) => {
	const { settings, coordinator } = fixture(t);
	const worker = `const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));const id=process.argv[2];c.request({requestId:id,owner:id,task:id,operation:'playtest',checkout:process.argv[3],sessionPath:process.argv[4]});console.log(JSON.stringify(c.acquire({requestId:id,owner:id,task:id})));`;
	const results = await Promise.all(
		["A", "B"].map((id) => child(worker, settings, [id, `/worktrees/${id}`, `/sessions/${id}.json`])),
	);
	assert.equal(results.filter((item) => item.acquired).length, 1);
	assert.equal(results.filter((item) => item.reason === "occupied" || item.reason === "queued").length, 1);
	const state = coordinator.inspect();
	assert.equal(state.requests.length, 2);
	assert.equal(state.active.requestId, state.requests[0].requestId);
	assert.equal(state.active.token, undefined);
});

test("FIFO persists across clients; cancellation and idempotent retries cannot jump queue", async (t) => {
	const { settings, coordinator: c } = fixture(t);
	request(c, "A");
	request(c, "B");
	request(c, "C");
	assert.equal(request(c, "B").sequence, 2);
	assert.equal(acquire(c, "B").reason, "queued");
	const a = acquire(c, "A");
	assert.throws(() => acquire(c, "A"), /ownership mismatch/);
	assert.equal(acquire(c, "A", { token: a.token }).token, a.token);
	c.cancel({ requestId: "B", owner: "B", task: "task-B" });
	c.cancel({ requestId: "B", owner: "B", task: "task-B" });
	assert.throws(() => request(c, "A", { operation: "capture" }), /different ownership/);
	await c.release({ token: a.token }, async () => proof(c));
	const other = createCoordinator(settings);
	assert.equal(acquire(other, "C").acquired, true);
	assert.throws(() => acquire(c, "B"), /cancelled/);
});

test("different project identifiers cannot create parallel ownership of one instance", (t) => {
	const { settings, coordinator: a } = fixture(t);
	const b = createCoordinator({ ...settings, projectId: "other-project" });
	request(a, "A");
	const active = acquire(a, "A");
	request(b, "B");
	assert.equal(acquire(b, "B").reason, "occupied");
	assert.throws(() => b.assertOwnership({ token: active.token }), /ownership mismatch/);
});

test("wrong owners cannot mutate, cancel, nest or release", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A");
	const a = acquire(c, "A");
	assert.throws(() => c.assertOwnership({ token: "wrong" }), /ownership mismatch/);
	assert.throws(() => c.assertOwnership({ token: a.token, owner: "wrong" }), /owner\/task mismatch/);
	assert.throws(() => c.beginOperation({ token: "wrong", operation: "input" }), /ownership mismatch/);
	assert.throws(() => c.cancel({ requestId: "A", owner: "A", task: "task-A" }), /verified release/);
	await assert.rejects(
		c.release({ token: "wrong" }, async () => proof(c)),
		/ownership mismatch/,
	);
	assert.equal(c.inspect().active.requestId, "A");
});

test("nested spans persist and prevent premature release or ending a parent", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A");
	const { token } = acquire(c, "A");
	const parent = c.beginOperation({ token, operation: "playtest", operationId: "test" });
	const child = c.beginOperation({ token, operation: "input", parentId: parent.operationId });
	assert.throws(() => c.endOperation({ token, operationId: parent.operationId }), /Nested/);
	await assert.rejects(
		c.release({ token }, async () => proof(c)),
		/still active/,
	);
	c.endOperation({ token, operationId: child.operationId });
	c.endOperation({ token, operationId: parent.operationId });
	assert.equal((await c.release({ token }, async () => proof(c))).released, true);
});

test("cleanup blocks racing mutation and transfer until live verifier succeeds", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A");
	request(c, "B");
	const { token } = acquire(c, "A");
	let finish;
	const pending = c.release(
		{ token },
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	assert.throws(() => c.beginOperation({ token, operation: "new-edit" }), /verification in progress/);
	assert.equal(acquire(c, "B").reason, "occupied");
	await assert.rejects(
		c.recover({ token }, async () => proof(c)),
		/verifier is alive/,
	);
	finish(proof(c));
	await pending;
	assert.equal(acquire(c, "B").acquired, true);
});

test("failed cleanup retains ownership and needs explicit verified recovery", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A");
	request(c, "B");
	const { token } = acquire(c, "A");
	await assert.rejects(
		c.release({ token }, async () => proof(c, { deviceRestored: false })),
		/deviceRestored/,
	);
	assert.equal(c.inspect().active.phase, "recoveryRequired");
	assert.throws(() => c.assertOwnership({ token }), /requires recovery/);
	assert.ok(c.assertOwnership({ token, cleanup: true }));
	assert.equal(acquire(c, "B").reason, "occupied");
	assert.equal((await c.recover({ token }, async () => proof(c))).released, true);
});

test("stale heartbeat never expires ownership and cannot be renewed into permission", async (t) => {
	let time = Date.now();
	const { coordinator: c } = fixture(t, { now: () => time, heartbeatMs: 1000 });
	request(c, "A");
	request(c, "B");
	const { token } = acquire(c, "A");
	time += 1001;
	assert.equal(c.inspect().active.recoveryRequired, true);
	assert.throws(() => c.heartbeat({ token }), /requires recovery/);
	assert.equal(acquire(c, "B").reason, "occupied");
	await c.recover({ token }, async () => proof(c, { observedAt: new Date(time).toISOString() }));
	assert.equal(acquire(c, "B").acquired, true);
});

test("crashed controller keeps persistent spans and requires resolving orphan operations", async (t) => {
	const { settings, coordinator: c } = fixture(t);
	const result = await child(
		`const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));c.request({requestId:'A',owner:'A',task:'A',operation:'playtest',checkout:'/a'});const r=c.acquire({requestId:'A',owner:'A',task:'A',controllerPid:process.pid});c.beginOperation({token:r.token,operation:'start-play'});console.log(JSON.stringify(r));`,
		settings,
	);
	assert.equal(c.inspect().active.controllerAlive, false);
	assert.throws(() => c.assertOwnership({ token: result.token }), /requires recovery/);
	await assert.rejects(
		c.recover({ token: result.token }, async () => proof(c)),
		/Orphan/,
	);
	await c.recover({ token: result.token }, async () => proof(c, { orphanOperationsResolved: true }));
	assert.equal(c.inspect().active, null);
});

test("boolean proof, wrong identity, stale evidence and unresolved requirements are rejected", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A", { requirements: ["syncStopped"] });
	const { token } = acquire(c, "A");
	await assert.rejects(c.release({ token }, true), /trusted live cleanup verifier/);
	await assert.rejects(
		c.release({ token }, async () => proof(c, { studioId: "wrong" })),
		/wrong Studio/,
	);
	await assert.rejects(
		c.recover({ token }, async () => proof(c, { observedAt: "2000-01-01" })),
		/stale/,
	);
	await assert.rejects(
		c.recover({ token }, async () => proof(c)),
		/syncStopped/,
	);
	await c.recover({ token }, async () => proof(c, { syncStopped: true }));
});

test("crashed ledger writer fails closed; mutex repair never releases Studio", async (t) => {
	const { settings, coordinator: c } = fixture(t, { lockTimeoutMs: 20 });
	request(c, "A");
	acquire(c, "A");
	await child(
		`const fs=require('node:fs');const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));const lock=c.file.replace(/\\.json$/,'.lock');fs.mkdirSync(lock);fs.writeFileSync(require('node:path').join(lock,'owner.json'),JSON.stringify({pid:process.pid,nonce:'crashed'}));console.log('{}');`,
		settings,
	);
	assert.throws(() => c.inspect(), /writer crashed/);
	assert.equal(c.recoverMutex().reservationUnchanged, true);
	assert.equal(c.inspect().active.requestId, "A");
});

test("unknown mutex owner and damaged ledger refuse reassignment", (t) => {
	const { coordinator: c } = fixture(t, { lockTimeoutMs: 20 });
	const lock = c.file.replace(/\.json$/, ".lock");
	fs.mkdirSync(lock);
	assert.throws(() => c.recoverMutex(), /Unknown mutex/);
	fs.rmSync(lock, { recursive: true });
	fs.writeFileSync(c.file, "broken-json");
	assert.throws(() => request(c, "A"), /unreadable/);
});

test("inspection omits bearer token and arbitrary supplied credential fields", (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A", { password: "do-not-store", headers: { Authorization: "Bearer do-not-store" } });
	const { token } = acquire(c, "A");
	const display = JSON.stringify(c.inspect());
	assert.ok(!display.includes(token));
	assert.ok(!fs.readFileSync(c.file, "utf8").includes("do-not-store"));
});

test("cleanup verifier may run nested guarded probes but cannot leave one running", async (t) => {
	const { coordinator: c } = fixture(t);
	request(c, "A");
	const { token } = acquire(c, "A");
	await assert.rejects(
		c.release({ token }, async () => {
			assert.ok(c.assertOwnership({ token, cleanup: true }));
			c.beginOperation({ token, operation: "readback", cleanup: true });
			return proof(c);
		}),
		/left active/,
	);
	assert.equal(c.inspect().active.phase, "recoveryRequired");
	await c.recover({ token }, async () => {
		const probe = c.beginOperation({ token, operation: "cleanup-readback", cleanup: true });
		c.endOperation({ token, operationId: probe.operationId });
		return proof(c, { orphanOperationsResolved: true });
	});
	assert.equal(c.inspect().active, null);
});

test("cleanup heartbeat cannot clear the ambiguity of an expired controller", async (t) => {
	let time = Date.now();
	const { coordinator: c } = fixture(t, { now: () => time, heartbeatMs: 1000 });
	request(c, "A");
	const { token } = acquire(c, "A");
	time += 1001;
	assert.throws(() => c.assertOwnership({ token }), /requires recovery/);
	const cleanup = c.beginOperation({ token, operation: "cleanup", cleanup: true });
	c.endOperation({ token, operationId: cleanup.operationId });
	assert.throws(() => c.assertOwnership({ token }), /requires recovery/);
	await c.recover({ token }, async () => proof(c, { observedAt: new Date(time).toISOString() }));
});

test("a process crash during cleanup verification remains recoverable without takeover", async (t) => {
	const { settings, coordinator: c } = fixture(t);
	const result = await child(
		`const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));c.request({requestId:'A',owner:'A',task:'A',operation:'playtest',checkout:'/a'});const r=c.acquire({requestId:'A',owner:'A',task:'A'});c.release({token:r.token},async()=>{console.log(JSON.stringify(r));process.exit(0);});`,
		settings,
	);
	assert.equal(c.inspect().active.phase, "verifyingCleanup");
	await c.recover({ token: result.token }, async () => proof(c, { orphanOperationsResolved: true }));
	assert.equal(c.inspect().active, null);
});

async function liveChild(t, script, settings, extra = []) {
	const worker = spawn(process.execPath, ["-e", script, JSON.stringify(settings), ...extra], {
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	const exited = new Promise((resolve) => worker.once("close", resolve));
	t.after(async () => {
		worker.stdin.end();
		await exited;
	});
	const value = await new Promise((resolve, reject) => {
		let output = "",
			errors = "";
		worker.once("error", reject);
		worker.stderr.on("data", (data) => {
			errors += data;
		});
		worker.stdout.on("data", (data) => {
			output += data;
			if (output.includes("\n")) resolve(JSON.parse(output.slice(0, output.indexOf("\n"))));
		});
		worker.once("exit", (code) => {
			if (!output.includes("\n")) reject(Error(errors || `Worker exited before readiness (${code})`));
		});
	});
	return { worker, value };
}

test("recovery cannot release a different live controller even with asserted complete proof", async (t) => {
	const { settings, coordinator: c } = fixture(t);
	const { value } = await liveChild(
		t,
		`const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));c.request({requestId:'A',owner:'A',task:'A',operation:'playtest',checkout:'/a'});const r=c.acquire({requestId:'A',owner:'A',task:'A',controllerPid:process.pid});console.log(JSON.stringify(r));process.stdin.resume();`,
		settings,
	);
	let verified = false;
	await assert.rejects(
		c.recover({ token: value.token }, async () => {
			verified = true;
			return proof(c, { orphanOperationsResolved: true });
		}),
		/controller is still alive/,
	);
	assert.equal(verified, false);
	assert.equal(c.inspect().active.requestId, "A");
});

test("original controller cannot recover while a different live process owns an active span", async (t) => {
	const { settings, coordinator: c } = fixture(t);
	request(c, "A");
	const { token } = acquire(c, "A", { controllerPid: process.pid });
	await liveChild(
		t,
		`const c=require(${moduleName}).createCoordinator(JSON.parse(process.argv[1]));const span=c.beginOperation({token:process.argv[2],operation:'upload'});console.log(JSON.stringify(span));process.stdin.resume();`,
		settings,
		[token],
	);
	await assert.rejects(
		c.recover({ token }, async () => proof(c, { orphanOperationsResolved: true })),
		/operation process is alive/,
	);
	assert.equal(c.inspect().active.requestId, "A");
});

test("environment project identity must match checkout configured place", (t) => {
	const { directory } = fixture(t);
	fs.writeFileSync(
		path.join(directory, "studio-tools.json"),
		JSON.stringify({ expectedPlaceId: "configured-place" }),
	);
	const prior = process.env.STUDIO_RESERVATION_PROJECT;
	t.after(() => {
		if (prior === undefined) delete process.env.STUDIO_RESERVATION_PROJECT;
		else process.env.STUDIO_RESERVATION_PROJECT = prior;
	});
	process.env.STUDIO_RESERVATION_PROJECT = "other-place";
	assert.throws(() => contextFromEnvironment(directory), /does not match.*expectedPlaceId/);
});
