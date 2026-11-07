// Isolated test process: fictitious place, never a live upload target.
const injectedConfig = require("./studio-config.cjs");
const originalReadConfig = injectedConfig.read;
injectedConfig.read = (root) =>
	!root || require("node:path").resolve(root) === require("node:path").resolve(__dirname, "..")
		? { expectedPlaceId: "123456789" }
		: originalReadConfig(root);
const test = require("node:test"),
	assert = require("node:assert/strict");
const fs = require("node:fs"),
	path = require("node:path"),
	os = require("node:os");
const { click, validateClick } = require("./studio-input.cjs");
const { validateDevice } = require("./studio-device.cjs");
const { scenario } = require("./studio-scenario.cjs");
const studio = { id: "fixture" };
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-input-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const session = path.join(root, "session.json");
	fs.writeFileSync(session, JSON.stringify({ studioId: studio.id, status: "running", token: "owned" }));
	return { root, session };
}
function request(code) {
	const m = code.split("\n")[0].match(/JSONDecode\(\[(=*)\[([\s\S]*)\]\1\]\)/);
	return m && JSON.parse(m[2]);
}
function inputPeer(options = {}) {
	const actions = [],
		moves = [];
	let armed = false;
	return {
		actions,
		moves,
		async call(name, args) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: Play" };
			if (name === "user_mouse_input") {
				moves.push(args.actions[0]);
				if (options.failNative) throw Error("input bridge disconnected");
				return {};
			}
			assert.equal(name, "execute_luau");
			const r = request(args.code);
			if (!r) return { robloxStudio: 1, ok: true, token: "owned" };
			actions.push(r.action);
			let value;
			if (r.action === "target" || r.action === "arm") {
				if (options.hidden) throw Error("GUI target is hidden");
				armed = r.action === "arm";
				value = { x: 120, y: 200, viewport: options.viewport || [750, 323, 0, 20] };
			} else if (r.action === "calibrate") value = { x: 375, y: 161.5 };
			else if (r.action === "measured") {
				if (options.noEvent) throw Error("No native input received");
				value = { x: 313, y: 141.5, inputType: options.inputType };
			} else if (r.action === "activated") {
				assert(armed);
				value = { count: options.count ?? 1, inputType: "Touch", trace: options.trace };
			} else if (r.action === "cleanup") {
				if (options.cleanupFail) throw Error("cleanup connection failed");
				value = true;
			} else throw Error(r.action);
			return { robloxStudio: 1, ok: true, value };
		},
	};
}
test("calibrated native click measures offset on overlay and clicks game button once", async (t) => {
	const f = fixture(t),
		peer = inputPeer(),
		state = {};
	const args = { instance_path: "LocalPlayer.PlayerGui.Menu.Use" };
	const result = await click(peer, studio, args, f.session, state);
	assert.deepEqual(result.offset, { x: 62, y: 20 });
	assert.equal(result.activations, 1);
	assert.deepEqual(
		peer.moves.map(({ x, y }) => [x, y]),
		[
			[375, 161.5],
			[182, 220],
		],
	);
	assert.equal(peer.actions.at(-1), "cleanup");
	await click(peer, studio, args, f.session, state);
	assert.equal(peer.actions.filter((x) => x === "calibrate").length, 1);
	assert.equal(peer.moves.length, 3);
});
test("missed target and native failures clean up without retrying the game action", async (t) => {
	const f = fixture(t),
		args = { instance_path: "LocalPlayer.PlayerGui.Menu.Use" };
	for (const options of [
		{ count: 0 },
		{ count: 2 },
		{ failNative: true },
		{ noEvent: true },
		{ hidden: true },
	]) {
		const peer = inputPeer(options),
			state = {};
		await assert.rejects(click(peer, studio, args, f.session, state));
		assert.equal(peer.actions.at(-1), "cleanup");
		assert(peer.moves.length <= 2);
		assert.equal(state.signature, undefined);
		if (options.hidden) assert.equal(peer.moves.length, 0);
	}
	const peer = inputPeer({ cleanupFail: true });
	await assert.rejects(click(peer, studio, args, f.session), /Input cleanup failed/);
});
test("viewport changes recalibrate and invalid target/session cannot send native input", async (t) => {
	const f = fixture(t),
		options = {},
		peer = inputPeer(options),
		state = {},
		args = { instance_path: "LocalPlayer.PlayerGui.Menu.Use" };
	await click(peer, studio, args, f.session, state);
	options.viewport = [401, 720, 0, 62];
	await click(peer, studio, args, f.session, state);
	assert.equal(peer.actions.filter((x) => x === "calibrate").length, 2);
	assert.throws(() => validateClick({ instance_path: "Workspace.Button" }), /PlayerGui/);
	assert.throws(() => validateClick({ ...args, studio_id: "other" }), /instance_path/);
	fs.writeFileSync(f.session, JSON.stringify({ studioId: "other", status: "running", token: "owned" }));
	const before = peer.moves.length;
	await assert.rejects(click(peer, studio, args, f.session), /No owned playtest/);
	assert.equal(peer.moves.length, before);
});
test("device selection validates before any session mutation", () => {
	assert.deepEqual(validateDevice({ name: "iPhone 17 Pro", orientation: "Portrait" }), {
		name: "iPhone 17 Pro",
		orientation: "Portrait",
	});
	for (const bad of [
		null,
		{},
		[],
		{ name: "x", id: "y" },
		{ id: "default", orientation: "Portrait" },
		{ name: "x", orientation: "Bad" },
	])
		assert.throws(() => validateDevice(bad));
});
test("partial device setup failure restores separately recorded snapshot without starting Play", async (t) => {
	const f = fixture(t),
		probe = path.join(f.root, "probe.luau");
	fs.writeFileSync(probe, "return {passed=true}");
	const actions = [],
		old = { id: "default", orientation: "LandscapeRight" };
	const client = {
		async request() {
			return { tools: [] };
		},
		async call(name, args) {
			assert.equal(name, "execute_luau");
			const r = request(args.code);
			actions.push(r.action);
			if (r.action === "configure") throw Error("orientation setup failed after device selected");
			if (r.action === "restore") assert.deepEqual(r.value, old);
			return { robloxStudio: 1, ok: true, value: old };
		},
	};
	const report = await scenario(
		client,
		studio,
		{
			version: 1,
			name: "device-failure",
			device: { name: "iPhone 17 Pro", orientation: "Portrait" },
			steps: [{ kind: "probe", context: "Client", file: probe }],
		},
		{ base: f.root, session: f.session },
	);
	assert.equal(report.passed, false);
	assert.match(report.error, /orientation/);
	assert.deepEqual(report.deviceRestored, old);
	assert.deepEqual(actions, ["snapshot", "configure", "restore"]);
});

test("missed native clicks identify intercepting UI without another game action", async (t) => {
	const f = fixture(t),
		peer = inputPeer({
			count: 0,
			trace: { x: 120, y: 200, hits: ["Players.Test.PlayerGui.TouchGui.TouchControlFrame"] },
		});
	await assert.rejects(
		click(peer, studio, { instance_path: "LocalPlayer.PlayerGui.Menu.Use" }, f.session, {}),
		/TouchGui.TouchControlFrame/,
	);
	assert.equal(peer.moves.length, 2);
	assert.equal(peer.actions.at(-1), "cleanup");
});
