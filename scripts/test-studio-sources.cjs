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
const crypto = require("node:crypto");
const { fetchSources, writeBundle, normalizePaths, main } = require("./studio-sources.cjs");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const targets = [
	["ReplicatedStorage", "A"],
	["ServerScriptService", "B"],
];
function mock(sources, modify = () => {}) {
	let calls = 0;
	return {
		async call(name, args) {
			assert.equal(name, "execute_luau");
			assert.equal(args.datamodel_type, "Edit");
			const request = JSON.parse(args.code.split("\n")[0].match(/JSONDecode\(\[(=*)\[([\s\S]*)\]\1\]\)/)[2]);
			assert.ok(request.items.reduce((n, item) => n + item.length, 0) <= 24000);
			const response = {
				robloxStudio: 1,
				ok: true,
				placeId: "123",
				items: request.items.map((item) => {
					const source = sources[JSON.stringify(item.segments)];
					if (source === undefined) return { segments: item.segments, ok: false, error: "Missing path" };
					const bytes = Buffer.from(source);
					return {
						ok: true,
						segments: item.segments,
						sourceMode: request.sourceMode,
						className: "ModuleScript",
						bytes: bytes.length,
						sha256: sha(bytes),
						offset: item.offset,
						differsFromStored: false,
						data: bytes.subarray(item.offset, item.offset + item.length).toString("base64"),
					};
				}),
			};
			modify(response, ++calls);
			return response;
		},
	};
}
const studio = { id: "selected" };
test("batches small scripts into one source call and preserves raw UTF-8/CRLF", async () => {
	const texts = ['-- 🐉\r\nreturn "→"\r\n', ""];
	const fetched = await fetchSources(
		mock(Object.fromEntries(targets.map((p, i) => [JSON.stringify(p), texts[i]]))),
		studio,
		"123",
		targets,
	);
	assert.equal(fetched.calls, 1);
	assert.deepEqual(
		fetched.records.map((r) => r.data.toString()),
		texts,
	);
});
test("large UTF-8 source survives byte boundaries without dropped or repeated bytes", async () => {
	const source = "🐉é\r\n".repeat(10000);
	const fetched = await fetchSources(mock({ [JSON.stringify(targets[0])]: source }), studio, "123", [
		targets[0],
	]);
	assert.ok(fetched.calls > 1);
	assert.equal(fetched.records[0].data.toString(), source);
});
test("rejects truncation, corruption, wrong provenance and source changes", async () => {
	const source = "a".repeat(40000);
	for (const modify of [
		(r) => {
			r.items[0].data = "";
		},
		(r) => {
			r.placeId = "456";
		},
		(r) => {
			r.items[0].segments = targets[1];
		},
		(r) => {
			r.items[0].sourceMode = "stored";
		},
		(r, call) => {
			if (call === 2) r.items[0].sha256 = "f".repeat(64);
		},
		(r) => {
			r.items[0].data = Buffer.alloc(Buffer.from(r.items[0].data, "base64").length, "b").toString("base64");
		},
	])
		await assert.rejects(
			fetchSources(mock({ [JSON.stringify(targets[0])]: source }, modify), studio, "123", [targets[0]]),
		);
});
test("partial failures remain explicit, filenames cannot escape, existing bundles survive", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-sources-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const paths = [["ServerStorage", "../a.b"], targets[1]];
	const fetched = await fetchSources(
		mock({ [JSON.stringify(paths[0])]: "return 1" }),
		studio,
		"123",
		paths,
		"stored",
	);
	const output = path.join(dir, "bundle");
	const receipt = writeBundle(output, fetched, { sourceMode: "stored" });
	assert.equal(receipt.complete, false);
	assert.equal(receipt.failed, 1);
	assert.deepEqual(fs.readdirSync(output).sort(), ["001.luau", "manifest.json"]);
	const manifest = JSON.parse(fs.readFileSync(receipt.manifest));
	assert.equal(manifest.scripts[1].status, "error");
	assert.equal(manifest.scripts[1].file, undefined);
	assert.equal(sha(fs.readFileSync(path.join(output, "001.luau"))), manifest.scripts[0].sha256);
	assert.throws(() => writeBundle(output, fetched, {}), /EEXIST/);
});
test("normalizes ordinary paths, preserves exact segments, rejects duplicates and excessive requests", () => {
	assert.deepEqual(normalizePaths(["game.ServerStorage.A", ["ServerStorage", "A.B"]]), [
		["ServerStorage", "A"],
		["ServerStorage", "A.B"],
	]);
	for (const input of [[], ["A..B"], ["A.B", "game.A.B"], Array(17).fill("A.B")])
		assert.throws(() => normalizePaths(input));
});
test("wrong place and active playtests fail before source execution and close transport", async () => {
	for (const scenario of ["wrong-place", "play"]) {
		let closed = false;
		const calls = [];
		const client = {
			async connect() {},
			close() {
				closed = true;
			},
			async call(name) {
				calls.push(name);
				if (name === "list_roblox_studios")
					return { studios: [{ id: "a", placeId: scenario === "wrong-place" ? "123" : "107800205420358" }] };
				if (name === "get_studio_state") return { text: "Current Studio Mode: Play" };
				throw Error("Unexpected call");
			},
		};
		await assert.rejects(main(["ServerStorage.A"], { client, write() {} }));
		assert.ok(closed);
		assert.ok(!calls.includes("execute_luau"));
	}
});
