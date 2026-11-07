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
const { lifecycle } = require("./studio-native-play.cjs");
function fixture(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-play-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const f = {
		studio: { id: "one" },
		file: path.join(dir, "session.json"),
		mode: "Edit",
		token: "",
		marker: "",
		pending: 0,
		ends: 0,
		starts: 0,
	};
	f.client = {
		async call(name, args) {
			if (name === "get_studio_state") return { text: "Current Studio Mode: " + f.mode };
			assert.equal(name, "execute_luau");
			const c = args.code;
			const ok = { robloxStudio: 1, ok: true };
			if (c.includes("contextProbe=true")) {
				if (args.datamodel_type === "Client" && f.clientFailure)
					throw Error("Client datamodel is not available in Edit mode");
				return { ...ok, contextProbe: true, running: f.mode === "Play" };
			}
			if (c.includes("ExecutePlayModeAsync")) {
				f.starts++;
				if (f.startFailure) throw Error("Timeout");
				f.token = c.match(/robloxToolsToken='([^']+)'/)[1];
				f.mode = "Play";
				return ok;
			}
			if (c.includes("SetAttribute('RobloxToolsToolingSession'")) {
				if (f.argsMismatch) throw Error("Different test args");
				f.marker = f.token;
				return ok;
			}
			if (c.includes("token=game:GetAttribute")) return { ...ok, token: f.marker };
			if (c.includes(":EndTest(")) {
				if (f.argsMismatch) throw Error("Different test args");
				f.ends++;
				f.mode = "Edit";
				if (f.lostStop) throw Error("Timed out");
				return ok;
			}
			if (c.includes("pending=game:GetAttribute"))
				return {
					...ok,
					pending: f.foreignCallback ? "foreign" : f.pending-- > 0 ? f.token : "",
					result: f.missingReceipt
						? ""
						: JSON.stringify({ token: f.foreignReceipt ? "foreign" : f.token, ok: true }),
				};
			if (c.includes("SetAttribute('RobloxToolsNativeResult',nil)")) {
				f.cleaned = true;
				return ok;
			}
			throw Error("Unexpected code: " + c);
		},
	};
	f.run = (action) => lifecycle(f.client, f.studio, action, f.file, async () => {});
	f.record = () => JSON.parse(fs.readFileSync(f.file));
	return f;
}
test("native stop waits for owned callback after Edit transition", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.pending = 10;
	await f.run("stop");
	assert.equal(f.record().status, "stopped");
	assert.equal(f.ends, 1);
	assert(f.cleaned);
});
test("existing Play session is never adopted", async (t) => {
	const f = fixture(t);
	f.mode = "Play";
	await assert.rejects(f.run("start"), /Another test/);
	assert.equal(f.starts, 0);
	assert(!fs.existsSync(f.file));
});
test("uncertain start remains recoverable and is not retried", async (t) => {
	const f = fixture(t);
	f.startFailure = true;
	await assert.rejects(f.run("start"), /Timeout/);
	assert.equal(f.starts, 1);
	assert.equal(f.record().status, "unconfirmed");
	assert.equal(f.ends, 0);
});
test("foreign runtime marker or test args prevent EndTest", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.marker = "foreign";
	await assert.rejects(f.run("stop"), /ownership marker changed/);
	assert.equal(f.ends, 0);
	f.marker = f.token;
	f.argsMismatch = true;
	await assert.rejects(f.run("stop"), /Different test args/);
	assert.equal(f.ends, 0);
});
test("missing client cleans up only the marked server", async (t) => {
	const f = fixture(t);
	f.clientFailure = true;
	await assert.rejects(f.run("start"), /did not become ready/);
	assert.equal(f.ends, 1);
	assert.equal(f.record().status, "stopped");
});
test("foreign callback is preserved and cannot be marked stopped", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.foreignCallback = true;
	await assert.rejects(f.run("stop"), /callback ownership changed/);
	assert.equal(f.record().status, "running");
	assert(!f.cleaned);
});
test("callback timeout preserves recovery evidence", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.pending = 100;
	await assert.rejects(f.run("stop"), /has not returned/);
	assert.equal(f.record().status, "running");
	assert(!f.cleaned);
});

test("lost stop response reconciles exact native completion without repeating EndTest", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.lostStop = true;
	await assert.rejects(f.run("stop"), /Timed out/);
	assert.equal(f.record().status, "running");
	await f.run("stop");
	assert.equal(f.ends, 1);
	assert.equal(f.record().status, "stopped");
	assert.equal(f.record().stopReconciled, true);
});

test("Edit mode without the matching completion receipt never releases an owned record", async (t) => {
	for (const kind of ["missingReceipt", "foreignReceipt"]) {
		const f = fixture(t);
		await f.run("start");
		f.mode = "Edit";
		f[kind] = true;
		await assert.rejects(f.run("stop"), /receipt|ownership changed/);
		assert.equal(f.record().status, "running");
		assert.equal(f.ends, 0);
		assert(!f.cleaned);
	}
});

test("unconfirmed starts cannot be adopted just because a callback appears", async (t) => {
	const f = fixture(t);
	await f.run("start");
	f.mode = "Edit";
	const r = f.record();
	r.status = "unconfirmed";
	fs.writeFileSync(f.file, JSON.stringify(r));
	await assert.rejects(f.run("stop"), /No confirmed/);
	assert.equal(f.ends, 0);
	assert(!f.cleaned);
});

test("turn cleanup reconciles a lost native stop but refuses an unconfirmed session", async (t) => {
	const { cleanupSessions } = require("./studio-turn.cjs");
	const f = fixture(t);
	await f.run("start");
	f.lostStop = true;
	await assert.rejects(f.run("stop"), /Timed out/);
	await cleanupSessions(f.client, f.studio, [f.file]);
	assert.equal(f.ends, 1);
	assert.equal(f.record().status, "stopped");
	const other = fixture(t);
	await other.run("start");
	other.mode = "Edit";
	const r = other.record();
	r.status = "unconfirmed";
	fs.writeFileSync(other.file, JSON.stringify(r));
	await assert.rejects(cleanupSessions(other.client, other.studio, [other.file]), /not confirmed stopped/);
	assert(!other.cleaned);
});
