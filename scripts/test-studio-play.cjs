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
const { mode, lifecycle } = require("./studio-play.cjs");
const { waitForContext } = require("./studio-state.cjs");
function setup(t, initial = "Edit") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-play-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "session.json");
	const calls = [];
	let state = initial;
	let token = "";
	const client = {
		async call(name, args) {
			calls.push({ name, args });
			if (name === "get_studio_state") return { text: `- Current Studio Mode: ${state}` };
			if (name === "start_stop_play") {
				state = args.is_start ? "Play" : "Edit";
				return { text: "ok" };
			}
			if (name === "execute_luau") {
				if (args.code.includes("contextProbe=true"))
					return { robloxStudio: 1, ok: true, contextProbe: true, running: state === "Play" };
				const match = args.code.match(/SetAttribute\("RobloxToolsToolingSession","([^"]+)"\)/);
				if (match) token = match[1];
				return { robloxStudio: 1, ok: true, token };
			}
			throw Error("Unexpected tool");
		},
	};
	return { client, file, calls, studio: { id: "a" } };
}
test("refuses ambiguous state and never guesses", () =>
	assert.throws(() => mode({ text: "unknown" }), /Unrecognized/));
test("start and stop retain ownership and verify actual mode", async (t) => {
	const { client, studio, file, calls } = setup(t);
	assert.equal((await lifecycle(client, studio, "start", file)).mode, "Play");
	assert.equal(JSON.parse(fs.readFileSync(file)).status, "running");
	assert.equal((await lifecycle(client, studio, "stop", file)).mode, "Edit");
	assert.equal(JSON.parse(fs.readFileSync(file)).status, "stopped");
	assert.equal(calls.filter((c) => c.name === "start_stop_play").length, 2);
});
test("does not adopt an existing playtest", async (t) => {
	const { client, studio, file, calls } = setup(t, "Play");
	await assert.rejects(lifecycle(client, studio, "start", file), /already active/);
	assert.equal(calls.filter((c) => c.name === "start_stop_play").length, 0);
	assert.equal(fs.existsSync(file), false);
});
test("does not stop tests without ownership or after Studio session changes", async (t) => {
	const { client, studio, file, calls } = setup(t, "Play");
	await assert.rejects(lifecycle(client, studio, "stop", file), /ENOENT/);
	fs.writeFileSync(file, JSON.stringify({ studioId: "other", status: "running" }));
	await assert.rejects(lifecycle(client, studio, "stop", file), /No owned/);
	assert.equal(calls.filter((c) => c.name === "start_stop_play").length, 0);
});
test("does not overwrite an existing ownership record", async (t) => {
	const { client, studio, file, calls } = setup(t);
	fs.writeFileSync(file, "original");
	await assert.rejects(lifecycle(client, studio, "start", file), /EEXIST/);
	assert.equal(fs.readFileSync(file, "utf8"), "original");
	assert.equal(calls.filter((c) => c.name === "start_stop_play").length, 0);
});
test("failed transition remains unconfirmed with no automatic second mutation", async (t) => {
	const { studio, file } = setup(t);
	let writes = 0;
	const client = {
		async call(name) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: Edit" };
			writes++;
			throw Error("Timeout");
		},
	};
	await assert.rejects(lifecycle(client, studio, "start", file), /Timeout/);
	assert.equal(JSON.parse(fs.readFileSync(file)).status, "unconfirmed");
	assert.equal(writes, 1);
});
test("does not stop a manually restarted test whose runtime marker vanished", async (t) => {
	const { client, studio, file, calls } = setup(t, "Play");
	fs.writeFileSync(file, JSON.stringify({ studioId: "a", token: "old-test", status: "running" }));
	await assert.rejects(lifecycle(client, studio, "stop", file), /ownership marker changed/);
	assert.equal(calls.filter((c) => c.name === "start_stop_play").length, 0);
});

test("readiness waits through stale labels, wrong runtime state and context unavailability", async () => {
	const states = ["Play", "Edit", "Edit", "Edit", "Edit"];
	let probes = 0;
	const client = {
		async call(name, args) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: " + states.shift() };
			assert.equal(name, "execute_luau");
			assert.equal(args.datamodel_type, "Edit");
			probes++;
			if (probes === 1) throw Error("Edit datamodel is not available in Play mode");
			return { robloxStudio: 1, ok: true, contextProbe: true, running: false };
		},
	};
	assert.equal((await waitForContext(client, { id: "a" }, "Edit", { pause: async () => {} })).ready, true);
	assert.equal(probes, 3);
});

test("readiness requires consecutive matching runtime probes and is bounded", async () => {
	let probes = 0;
	const client = {
		async call(name) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: Edit" };
			return { robloxStudio: 1, ok: true, contextProbe: true, running: ++probes % 2 === 0 };
		},
	};
	await assert.rejects(
		waitForContext(client, { id: "a" }, "Edit", { attempts: 4, pause: async () => {} }),
		/did not become ready/,
	);
	assert.equal(probes, 4);
});

test("readiness never retries transport or malformed response failures", async () => {
	for (const failure of [Error("Timed out"), { robloxStudio: 1, ok: true }]) {
		let probes = 0;
		const client = {
			async call(name) {
				if (name === "get_studio_state") return { text: "Current Studio Mode: Edit" };
				probes++;
				if (failure instanceof Error) throw failure;
				return failure;
			},
		};
		await assert.rejects(
			waitForContext(client, { id: "a" }, "Edit", { pause: async () => {} }),
			/Timed out|Malformed/,
		);
		assert.equal(probes, 1);
	}
});

test("readiness retries a missing bootstrap handler without rerunning a mutation", async () => {
	let probes = 0;
	const client = {
		async call(name, args) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: Play" };
			assert.match(args.code, /contextProbe=true/);
			if (++probes === 1)
				throw Error(
					"Network action ExecuteLuau.loadCode sent to DMN_ID_PLAYSERVER failed - Target is not reachable (ExecuteLuau.loadCode, DMN_ID_PLAYSERVER). No OnInvoke handler responded for this action. Sender: DMN_ID_STANDALONE.",
				);
			return { robloxStudio: 1, ok: true, contextProbe: true, running: true };
		},
	};
	assert.equal((await waitForContext(client, { id: "a" }, "Server", { pause: async () => {} })).ready, true);
	assert.equal(probes, 3);
});

test("client readiness failure stops the marked test and preserves stopped status", async (t) => {
	const f = setup(t),
		original = f.client.call.bind(f.client);
	f.client.call = async (name, args) => {
		if (name === "execute_luau" && args.datamodel_type === "Client")
			throw Error("Client datamodel is not available in Edit mode");
		return original(name, args);
	};
	await assert.rejects(
		lifecycle(f.client, f.studio, "start", f.file, async () => {}),
		/Owned playtest was stopped/,
	);
	assert.equal(JSON.parse(fs.readFileSync(f.file)).status, "stopped");
	assert.deepEqual(
		f.calls.filter((c) => c.name === "start_stop_play").map((c) => c.args.is_start),
		[true, false],
	);
});
