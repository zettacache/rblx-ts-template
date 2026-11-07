const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const { spawn, execFileSync } = require("node:child_process");

test("owned Rojo help needs no reservation or executable", () => {
	const output = execFileSync(process.execPath, [path.join(__dirname, "rojo-serve.cjs"), "--help"], {
		encoding: "utf8",
		windowsHide: true,
	});
	assert.match(output, /pinned executable/);
});
const {
	ensure,
	pathsFor,
	integrationCheckout,
	belongsToChild,
	inspectListener,
} = require("./rojo-serve.cjs");

const temporary = path.resolve(__dirname, "../build/test-temp");
fs.mkdirSync(temporary, { recursive: true });

function fixture(t, port = 34872) {
	const root = fs.mkdtempSync(path.join(temporary, "template-rojo-test-"));
	fs.writeFileSync(path.join(root, "default.project.json"), JSON.stringify({ servePort: port }));
	t.after(() => {
		assert.equal(path.dirname(root), temporary);
		assert.ok(path.basename(root).startsWith("template-rojo-test-"));
		fs.rmSync(root, { recursive: true, force: true });
	});
	const state = { allowed: true, spans: new Set(), recovery: [], probes: 0, online: false, spawned: 0 };
	const context = {
		token: "reservation-one",
		owner: "agent-one",
		task: "sync",
		studioId: "studio-one",
		projectId: "project-one",
		coordinator: {
			assertOwnership() {
				if (!state.allowed) throw Error("Wrong reservation owner");
				return { checkout: state.reservedCheckout || root };
			},
			beginOperation() {
				const operationId = `op-${state.spans.size + 1}`;
				state.spans.add(operationId);
				return { operationId };
			},
			endOperation({ operationId }) {
				if (state.cleanupFails) throw Error("Cleanup refused");
				state.spans.delete(operationId);
			},
			markRecovery({ reason }) {
				state.recovery.push(reason);
			},
		},
	};
	const child = new EventEmitter();
	child.pid = 12345;
	child.kill = () => {
		state.killed = true;
		state.online = false;
		child.emit("exit", 0);
		return true;
	};
	const options = {
		root,
		integrationRoot: root,
		directory: path.join(root, "coordination"),
		context,
		probe: async () => state.online,
		inspectListener: async () => ({ pid: child.pid, created: state.created, ancestors: [] }),
		spawn: () => {
			state.spawned++;
			state.created = new Date().toISOString();
			state.online = true;
			return child;
		},
		startupTimeoutMs: 30,
		pollMs: 1,
	};
	return { root, options, state, child, context };
}
async function stop(f, result) {
	f.state.online = false;
	f.child.emit("exit", 0);
	return result.completion;
}

test("unknown real occupied port is rejected without spawning or stopping it", async (t) => {
	const server = net.createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const f = fixture(t, server.address().port);
	delete f.options.probe;
	await assert.rejects(ensure(f.options), /Unknown or replaced listener/);
	assert.equal(f.state.spawned, 0);
	assert.equal(server.listening, true);
});

test("only a verified same checkout and reservation server is reused; no new span or stop ownership", async (t) => {
	const f = fixture(t);
	const first = await ensure(f.options);
	const second = await ensure(f.options);
	assert.equal(first.reused, false);
	assert.equal(second.reused, true);
	assert.equal(second.child, undefined);
	assert.equal(second.completion, undefined);
	assert.equal(f.state.spans.size, 1);
	assert.equal(f.state.spawned, 1);
	assert.equal((await stop(f, first)).clean, true);
	assert.equal(f.state.spans.size, 0);
});

test("worker checkouts cannot serve or reuse even with the same mapping and port", async (t) => {
	const integration = fixture(t);
	const worker = fixture(t);
	await assert.rejects(
		ensure({ ...worker.options, integrationRoot: integration.root }),
		/Worker checkout cannot serve/,
	);
	assert.equal(worker.state.spawned, 0);
});

test("default never switches from the explicitly reviewed Git checkout", async (t) => {
	const f = fixture(t);
	const worker = path.join(f.root, "worker");
	const git = (args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8", stdio: "pipe" });
	git(["init"]);
	git(["add", "default.project.json"]);
	git(["-c", "user.name=Tooling Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture"]);
	git(["worktree", "add", "--detach", worker]);
	const expected =
		process.platform === "win32" ? fs.realpathSync(f.root).toLowerCase() : fs.realpathSync(f.root);
	assert.equal(integrationCheckout(f.root), expected);
	assert.equal(
		integrationCheckout(worker),
		process.platform === "win32" ? fs.realpathSync(worker).toLowerCase() : fs.realpathSync(worker),
	);
});

test("mapping drift and different reservation cannot reuse a server", async (t) => {
	const f = fixture(t);
	const first = await ensure(f.options);
	await assert.rejects(
		ensure({ ...f.options, context: { ...f.context, token: "other-token" } }),
		/different Studio reservation/,
	);
	fs.writeFileSync(
		path.join(f.root, "default.project.json"),
		JSON.stringify({ servePort: 34872, name: "new mapping" }),
	);
	await assert.rejects(ensure(f.options), /projectHash mismatch/);
	await assert.rejects(first.verify(), /mapping changed/);
	await stop(f, first);
});

test("record for another checkout and replaced PID generation fail closed", async (t) => {
	const f = fixture(t);
	const first = await ensure(f.options);
	const recordPath = pathsFor(34872, f.options.directory).record;
	const record = JSON.parse(fs.readFileSync(recordPath));
	fs.writeFileSync(recordPath, JSON.stringify({ ...record, root: "other-checkout" }));
	await assert.rejects(ensure(f.options), /root mismatch/);
	fs.writeFileSync(recordPath, JSON.stringify(record));
	f.state.created = "2000-01-01T00:00:00.000Z";
	await assert.rejects(ensure(f.options), /Unknown or replaced listener/);
	await stop(f, first);
});

test("wrong owner cannot begin even a listener probe", async (t) => {
	const f = fixture(t);
	f.state.allowed = false;
	await assert.rejects(
		ensure({
			...f.options,
			probe: () => {
				throw Error("Must not probe");
			},
		}),
		/Wrong reservation owner/,
	);
	assert.equal(f.state.spawned, 0);
});

test("two real processes race for the same machine port startup lock", async (t) => {
	const f = fixture(t);
	const lock = pathsFor(34872, f.options.directory).lock;
	const script = `const { acquire } = require(process.argv[1]); process.stdout.write(acquire(process.argv[2]) ? 'won' : 'blocked');`;
	const run = () =>
		new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ["-e", script, require.resolve("./rojo-serve.cjs"), lock], {
				windowsHide: true,
			});
			let output = "";
			child.stdout.on("data", (data) => {
				output += data;
			});
			child.once("error", reject);
			child.once("exit", (code) => (code ? reject(Error(`Exit ${code}`)) : resolve(output)));
		});
	assert.deepEqual((await Promise.all([run(), run()])).sort(), ["blocked", "won"]);
	// Stale startup ownership is never reclaimed based only on a dead PID.
	await assert.rejects(ensure(f.options), /startup is in progress or interrupted/);
});

test("simultaneous ensure requests start one server and reject or verify the other", async (t) => {
	const f = fixture(t);
	const results = await Promise.allSettled([ensure(f.options), ensure(f.options)]);
	assert.equal(f.state.spawned, 1);
	const started = results.find((r) => r.status === "fulfilled" && !r.value.reused).value;
	const second = results.find((r) => r.status === "rejected");
	if (second) assert.match(second.reason.message, /startup is in progress|Unknown or replaced/);
	assert.equal((await stop(f, started)).clean, true);
});

test("failed process creation closes span and releases startup lock", async (t) => {
	const f = fixture(t);
	await assert.rejects(
		ensure({
			...f.options,
			spawn: () => {
				throw Error("Launch failed");
			},
		}),
		/Launch failed/,
	);
	assert.equal(f.state.spans.size, 0);
	assert.equal(fs.existsSync(pathsFor(34872, f.options.directory).lock), false);
	assert.equal(
		JSON.parse(fs.readFileSync(pathsFor(34872, f.options.directory).record)).state,
		"failed-before-spawn",
	);
});

test("descendant listener is accepted only with a current child generation", () => {
	const time = "2026-11-03T00:00:00.000Z";
	assert.equal(
		belongsToChild({ pid: 2, created: time, ancestors: [{ pid: 1, created: time }] }, 1, time),
		true,
	);
	assert.equal(
		belongsToChild(
			{ pid: 2, created: time, ancestors: [{ pid: 1, created: "2000-01-01T00:00:00Z" }] },
			1,
			time,
		),
		false,
	);
});

test("child exit while listener persists retains operation and marks recovery", async (t) => {
	const f = fixture(t);
	const result = await ensure(f.options);
	f.child.emit("exit", 0);
	assert.equal((await result.completion).clean, false);
	assert.equal(f.state.spans.size, 1);
	assert.match(f.state.recovery[0], /still occupied/);
	f.state.online = false;
	await assert.rejects(ensure(f.options), /unresolved/);
});

test("cleanup failure retains operation and recovery instead of claiming release", async (t) => {
	const f = fixture(t);
	const result = await ensure(f.options);
	f.state.cleanupFails = true;
	assert.equal((await stop(f, result)).clean, false);
	assert.equal(f.state.spans.size, 1);
	assert.match(f.state.recovery[0], /Cleanup refused/);
});

test("only original launcher can stop its server; reused handles cannot stop it", async (t) => {
	const f = fixture(t);
	const first = await ensure(f.options);
	const reused = await ensure(f.options);
	assert.equal(reused.stop, undefined);
	f.state.allowed = false;
	await assert.rejects(first.stop(), /Wrong reservation owner/);
	assert.equal(f.state.killed, undefined);
	f.state.allowed = true;
	assert.equal((await first.stop()).clean, true);
	assert.equal(f.state.killed, true);
	assert.equal(f.state.spans.size, 0);
});

test(
	"Windows listener identity reads the owning PID and creation time on a real isolated port",
	{ skip: process.platform !== "win32" },
	async (t) => {
		const server = net.createServer();
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		t.after(() => new Promise((resolve) => server.close(resolve)));
		const identity = await inspectListener(server.address().port);
		assert.equal(identity.pid, process.pid);
		assert.ok(Number.isFinite(Date.parse(identity.created)));
		assert.ok(Array.isArray(identity.ancestors));
	},
);

test("real reservation core refuses release for the full Rojo lifetime", async (t) => {
	const f = fixture(t);
	const coordinator = require("./studio-reservation.cjs").createCoordinator({
		directory: path.join(f.root, "reservations"),
		studioId: f.context.studioId,
		projectId: f.context.projectId,
	});
	coordinator.request({
		requestId: "sync-one",
		owner: f.context.owner,
		task: f.context.task,
		operation: "rojo-sync",
		checkout: f.root,
		requirements: ["syncStopped"],
	});
	const active = coordinator.acquire({ requestId: "sync-one", owner: f.context.owner, task: f.context.task });
	const context = { ...f.context, coordinator, token: active.token };
	const result = await ensure({ ...f.options, context });
	const proof = async () => ({
		studioId: context.studioId,
		projectId: context.projectId,
		observedAt: new Date().toISOString(),
		evidencePath: path.join(f.root, "cleanup.json"),
		editReady: true,
		sessionStopped: true,
		deviceRestored: true,
		temporaryStateCleared: true,
		syncStopped: true,
	});
	await assert.rejects(coordinator.release(context, proof), /Operations are still active/);
	assert.equal((await result.stop()).clean, true);
	assert.equal((await coordinator.release(context, proof)).released, true);
});

test("a token granted to another checkout cannot serve integration or probe its listener", async (t) => {
	const integration = fixture(t);
	const worker = fixture(t);
	integration.state.reservedCheckout = worker.root;
	await assert.rejects(
		ensure({
			...integration.options,
			probe: () => {
				throw Error("Must not probe");
			},
		}),
		/reservation belongs to a different checkout/,
	);
	assert.equal(integration.state.spawned, 0);
	assert.equal(integration.state.spans.size, 0);
});
