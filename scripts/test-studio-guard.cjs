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
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createCoordinator } = require("./studio-reservation.cjs");
const guard = require("./studio-guard.cjs");
const turn = require("./studio-turn.cjs");
const { McpClient } = require("./studio-mcp-client.cjs");
const ROOT = path.resolve(__dirname, "..");
const PROJECT = String(require("./studio-config.cjs").read().expectedPlaceId);
const ENV = [
	"LOCALAPPDATA",
	"STUDIO_RESERVATION_PROJECT",
	"STUDIO_RESERVATION_STUDIO",
	"STUDIO_RESERVATION_TOKEN",
	"STUDIO_RESERVATION_OWNER",
	"STUDIO_RESERVATION_TASK",
	"STUDIO_RESERVATION_CLEANUP",
	"STUDIO_TURN_RECORD",
];
function fixture(t, checkout = ROOT) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roblox-guard-test-"));
	const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
	ENV.forEach((k) => delete process.env[k]);
	process.env.LOCALAPPDATA = dir;
	t.after(() => {
		for (const key of ENV)
			saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
		// Only the unique fixture directory is removed; no external paths/junctions.
		assert.equal(path.dirname(dir), os.tmpdir());
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const coordinator = createCoordinator({ projectId: PROJECT, studioId: "guard-fixture" });
	coordinator.request({ requestId: "A", owner: "A", task: "guard-test", operation: "test", checkout });
	const owned = coordinator.acquire({ requestId: "A", owner: "A", task: "guard-test" });
	for (const [key, value] of Object.entries({
		PROJECT,
		STUDIO: "guard-fixture",
		TOKEN: owned.token,
		OWNER: "A",
		TASK: "guard-test",
	}))
		process.env["STUDIO_RESERVATION_" + key] = value;
	return { dir, coordinator, owned };
}

test("default MCP transport denies both callRaw and direct tools/call without a reservation", async (t) => {
	fixture(t);
	delete process.env.STUDIO_RESERVATION_TOKEN;
	const client = new McpClient(process.execPath, [path.join(__dirname, "fixtures/mock-studio-mcp.cjs")]);
	try {
		await client.connect();
		assert.ok(await client.call("get_studio_state", { studio_id: "guard-fixture" }));
		await assert.rejects(
			client.callRaw("execute_luau", { studio_id: "guard-fixture", code: "return 1" }),
			/STUDIO_RESERVATION_TOKEN/,
		);
		await assert.rejects(
			client.request("tools/call", {
				name: "start_stop_play",
				arguments: { studio_id: "guard-fixture", is_start: true },
			}),
			/STUDIO_RESERVATION_TOKEN/,
		);
	} finally {
		client.close();
	}
});

test("guard rejects another Studio, owner, and checkout before sending", async (t) => {
	const { coordinator } = fixture(t);
	let sent = 0;
	const send = async () => {
		sent++;
		return {};
	};
	await assert.rejects(guard.tool("execute_luau", { studio_id: "different" }, send), /different Studio/);
	process.env.STUDIO_RESERVATION_OWNER = "B";
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, send),
		/owner\/task mismatch/,
	);
	process.env.STUDIO_RESERVATION_OWNER = "A";
	const other = path.join(os.tmpdir(), "different-checkout");
	const state = coordinator.inspect();
	assert.equal(state.active.checkout, ROOT);
	assert.throws(() => guard.assert(other), /ENOENT|different checkout/);
	assert.equal(sent, 0);
});

test("matching identity cannot use a reservation queued for another checkout", async (t) => {
	fixture(t, path.join(os.tmpdir(), "worker-other"));
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => assert.fail("must not send")),
		/different checkout/,
	);
});

test("separate playtest session files cannot bypass the global reservation", async (t) => {
	const { dir, coordinator } = fixture(t);
	coordinator.request({
		requestId: "B",
		owner: "B",
		task: "another-test",
		operation: "playtest",
		checkout: ROOT,
		sessionPath: path.join(dir, "B.json"),
	});
	assert.equal(coordinator.acquire({ requestId: "B", owner: "B", task: "another-test" }).acquired, false);
	process.env.STUDIO_RESERVATION_TOKEN = "not-the-owner";
	let mutations = 0;
	const client = {
		call: (name, args) =>
			guard.tool(name, args, async () => {
				if (name === "get_studio_state") return { text: "Current Studio Mode: Edit" };
				mutations++;
				throw Error("Unexpected mutation");
			}),
	};
	const { lifecycle } = require("./studio-play.cjs");
	for (const name of ["independent-A.json", "independent-B.json"]) {
		await assert.rejects(
			lifecycle(client, { id: "guard-fixture" }, "start", path.join(dir, name)),
			/ownership mismatch/,
		);
	}
	assert.equal(mutations, 0);
	assert.equal(coordinator.inspect().active.requestId, "A");
});

test("ambiguous guarded transport failure retains its operation and prevents ordinary mutation", async (t) => {
	const { coordinator } = fixture(t);
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => {
			throw Error("Timed out");
		}),
		/Timed out/,
	);
	const state = coordinator.inspect();
	assert.equal(state.active.phase, "recoveryRequired");
	assert.equal(state.active.operations.length, 1);
	await assert.rejects(
		guard.tool("user_keyboard_input", { studio_id: "guard-fixture" }, async () => assert.fail()),
		/requires recovery/,
	);
});

test("owned cleanup scope survives recovery state without granting ordinary concurrent calls cleanup rights", async (t) => {
	const { coordinator, owned } = fixture(t);
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => {
			throw Error("probe rejected");
		}),
		/probe rejected/,
	);
	let release;
	const pause = new Promise((resolve) => {
		release = resolve;
	});
	let began;
	const ready = new Promise((resolve) => {
		began = resolve;
	});
	const cleanup = guard.withCleanup(async () => {
		began();
		await pause;
		return guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => ({ clean: true }));
	});
	await ready;
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () =>
			assert.fail("ordinary call must not run"),
		),
		/requires recovery/,
	);
	release();
	assert.deepEqual(await cleanup, { clean: true });
	assert.equal(coordinator.inspect().active.phase, "recoveryRequired");
	let verified = false;
	const result = await turn.finishOwnedTurn(coordinator, owned.token, async () => {
		verified = true;
		return {
			studioId: "guard-fixture",
			projectId: PROJECT,
			observedAt: new Date().toISOString(),
			evidencePath: path.join(os.tmpdir(), "mock-cleanup-proof"),
			editReady: true,
			sessionStopped: true,
			deviceRestored: true,
			temporaryStateCleared: true,
			syncStopped: true,
			orphanOperationsResolved: true,
		};
	});
	assert(verified);
	assert(result.released);
	assert.equal(coordinator.inspect().active, null);
});

test("recovery-aware turn completion retains ownership if its verifier fails", async (t) => {
	const { coordinator, owned } = fixture(t);
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => {
			throw Error("ambiguous");
		}),
		/ambiguous/,
	);
	await assert.rejects(
		turn.finishOwnedTurn(coordinator, owned.token, async () => {
			throw Error("device restoration failed");
		}),
		/restoration failed/,
	);
	assert.equal(coordinator.inspect().active.phase, "recoveryRequired");
});

test("scenario probe transport error stops its own native test under the real reservation guard", async (t) => {
	const { dir, coordinator } = fixture(t);
	const { scenario } = require("./studio-scenario.cjs");
	fs.writeFileSync(path.join(dir, "probe.luau"), 'error("expected probe failure")');
	let state = "Edit",
		token = "",
		ends = 0;
	const client = {
		async request() {
			return { tools: [] };
		},
		call(name, args) {
			return guard.tool(name, args, async () => {
				if (name === "get_studio_state") return { text: "Current Studio Mode: " + state };
				const code = args.code,
					ok = { robloxStudio: 1, ok: true };
				if (code.includes("contextProbe=true"))
					return { ...ok, contextProbe: true, running: state === "Play" };
				if (code.includes("ExecutePlayModeAsync")) {
					token = code.match(/robloxToolsToken='([^']+)'/)[1];
					state = "Play";
					return ok;
				}
				if (code.includes("local function check()")) throw Error("expected probe failure");
				if (code.includes(":EndTest(")) {
					ends++;
					state = "Edit";
					return ok;
				}
				if (code.includes("pending=game:GetAttribute"))
					return { ...ok, pending: "", result: JSON.stringify({ token, ok: true }) };
				return { ...ok, token };
			});
		},
	};
	const result = await scenario(
		client,
		{ id: "guard-fixture" },
		{
			version: 1,
			name: "failure cleanup",
			steps: [{ kind: "probe", context: "Client", file: "probe.luau" }],
		},
		{ base: dir, session: path.join(dir, "scenario.json") },
	);
	assert.equal(result.passed, false);
	assert.match(result.error, /expected probe failure/);
	assert.equal(result.cleanup.mode, "Edit");
	assert.equal(result.cleanupError, undefined);
	assert.equal(ends, 1);
	assert.equal(coordinator.inspect().active.phase, "recoveryRequired"); // Full turn verification is still required.
	await assert.rejects(
		guard.tool("execute_luau", { studio_id: "guard-fixture" }, async () => assert.fail()),
		/requires recovery/,
	);
});

test("real turn child exit failure records completion and closes only its own command span", async (t) => {
	const { dir, coordinator, owned } = fixture(t);
	const file = path.join(dir, "turn.json");
	const record = { file, token: owned.token, studioId: "guard-fixture", sessions: [] };
	fs.writeFileSync(file, JSON.stringify(record));
	await assert.rejects(
		turn.childCommand(["node", "-e", "process.exit(7)"], ROOT, process.env, record),
		/failed \(7\)/,
	);
	const latest = JSON.parse(fs.readFileSync(file));
	assert.equal(latest.commandState, "exited");
	assert.equal(latest.childExitCode, 7);
	assert.equal(coordinator.inspect().active.operations.length, 0);
	assert.equal(coordinator.inspect().active.requestId, "A");
});

test("cleanup refuses a still-live real child before any Studio query", async (t) => {
	const { dir, coordinator, owned } = fixture(t);
	const file = path.join(dir, "live-turn.json");
	const record = { file, token: owned.token, studioId: "guard-fixture", sessions: [] };
	fs.writeFileSync(file, JSON.stringify(record));
	const running = turn.childCommand(
		["node", "-e", "setTimeout(()=>process.exit(0),500)"],
		ROOT,
		process.env,
		record,
	);
	const latest = JSON.parse(fs.readFileSync(file));
	assert.throws(() => turn.assertDead(latest.childPid, "Turn child"), /alive/);
	await assert.rejects(
		turn.cleanup(
			{ call: async () => assert.fail("must refuse before Studio access") },
			{ id: "guard-fixture" },
			record,
			{},
		),
		/alive/,
	);
	assert.equal(coordinator.inspect().active.operations.length, 1);
	await running;
});

test("real controller crash retains reservation and command journal without automatic release", async (t) => {
	const { dir, coordinator, owned } = fixture(t);
	const file = path.join(dir, "crashed-turn.json");
	const record = { file, token: owned.token, studioId: "guard-fixture", sessions: [] };
	fs.writeFileSync(file, JSON.stringify(record));
	const script = `require(${JSON.stringify(path.join(__dirname, "studio-config.cjs"))}).read=()=>({expectedPlaceId:${JSON.stringify(PROJECT)}}); const fs=require('node:fs'); const turn=require(${JSON.stringify(path.join(__dirname, "studio-turn.cjs"))}); const record=JSON.parse(fs.readFileSync(${JSON.stringify(file)})); turn.childCommand(['node','-e','setTimeout(()=>process.exit(0),3500)'],${JSON.stringify(ROOT)},process.env,record).catch(()=>{}); setTimeout(()=>process.exit(9),100);`;
	const controller = spawn(process.execPath, ["-e", script], {
		stdio: "ignore",
		env: process.env,
		windowsHide: true,
	});
	const exit = await new Promise((resolve, reject) => {
		controller.once("error", reject);
		controller.once("exit", resolve);
	});
	assert.equal(exit, 9);
	const latest = JSON.parse(fs.readFileSync(file));
	assert.equal(latest.commandState, "running");
	assert.equal(coordinator.inspect().active.operations.length, 1);
	assert.equal(coordinator.inspect().active.requestId, "A");
	// Some Windows job hosts terminate descendants with their controller; Unix
	// commonly leaves this bounded child alive. Either way, ownership is retained.
	let childAlive = true;
	try {
		turn.assertDead(latest.childPid, "Turn child");
		childAlive = false;
	} catch {}
	if (childAlive)
		await assert.rejects(
			turn.cleanup(
				{ call: async () => assert.fail("must refuse before Studio access") },
				{ id: "guard-fixture" },
				record,
				{},
			),
			/alive/,
		);
	// Child is a bounded test fixture, so let it exit on its own (never stop an unrelated PID).
	const deadline = Date.now() + 6000;
	while (Date.now() < deadline) {
		try {
			turn.assertDead(latest.childPid, "Turn child");
			break;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	turn.assertDead(latest.childPid, "Turn child");
});

test("source identity changes for canonical code and ignores unrelated reports", (t) => {
	const { dir } = fixture(t);
	for (const folder of ["studio", "src"]) fs.mkdirSync(path.join(dir, folder));
	fs.writeFileSync(path.join(dir, "studio", "Module.luau"), "return 1");
	const initial = turn.sourceVersion(dir);
	fs.writeFileSync(path.join(dir, "report.json"), "{}");
	assert.equal(turn.sourceVersion(dir), initial);
	fs.writeFileSync(path.join(dir, "studio", "Module.luau"), "return 2");
	assert.notEqual(turn.sourceVersion(dir), initial);
});

test("changing a queued command plan is rejected before acquisition or bridge startup", async (t) => {
	const { dir, coordinator } = fixture(t);
	const file = path.join(dir, "plan.json");
	fs.writeFileSync(path.join(dir, "cleanup.luau"), "return {robloxStudio=1,ok=true,clean=true}");
	const plan = {
		operation: "review",
		command: ["node", "-e", "process.exit(0)"],
		cleanupProbe: "cleanup.luau",
	};
	fs.writeFileSync(file, JSON.stringify(plan));
	const options = {
		action: "request",
		studio: "guard-fixture",
		request: "plan-test",
		owner: "B",
		task: "plan-test",
	};
	await turn.run(file, options);
	fs.writeFileSync(file, JSON.stringify({ ...plan, command: ["node", "-e", "process.exit(1)"] }));
	await assert.rejects(
		turn.run(file, { ...options, action: "run" }),
		/Queued checkout, source, or plan changed/,
	);
	assert.equal(coordinator.inspect().requests.find((x) => x.requestId === "plan-test").status, "queued");
	assert.equal(coordinator.inspect().active.requestId, "A");
});

test("turn recovery refuses a live original controller before bridge startup", async (t) => {
	const { dir, owned } = fixture(t);
	const file = path.join(dir, "plan.json");
	fs.writeFileSync(path.join(dir, "cleanup.luau"), "return {robloxStudio=1,ok=true,clean=true}");
	fs.writeFileSync(
		file,
		JSON.stringify({
			operation: "review",
			command: ["node", "-e", "process.exit(0)"],
			cleanupProbe: "cleanup.luau",
		}),
	);
	const record = path.join(dir, "record.json");
	fs.writeFileSync(
		record,
		JSON.stringify({
			planDigest: turn.readPlan(file).digest,
			owner: "A",
			task: "guard-test",
			studioId: "guard-fixture",
			projectId: PROJECT,
			controllerPid: process.pid,
			token: owned.token,
		}),
	);
	await assert.rejects(
		turn.run(file, {
			action: "recover",
			studio: "guard-fixture",
			request: "A",
			owner: "A",
			task: "guard-test",
			record,
		}),
		/controller.*alive/,
	);
});
