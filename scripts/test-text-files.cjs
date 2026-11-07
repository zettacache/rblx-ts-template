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
const { spawnSync } = require("node:child_process");
const { decodeText, readJson } = require("./text-files.cjs");
test("Unicode input accepts UTF-8, BOM UTF-8, and both BOM UTF-16 byte orders", () => {
	const text = '{"name":"Mossgate 🦖 café"}';
	const le = Buffer.from("\uFEFF" + text, "utf16le");
	for (const bytes of [Buffer.from(text), Buffer.from("\uFEFF" + text), le, Buffer.from(le).swap16()])
		assert.equal(decodeText(bytes), text);
});
test("bad Unicode and unmarked UTF-16 fail explicitly instead of corrupting source", () => {
	for (const bytes of [
		Buffer.from([0xc3, 0x28]),
		Buffer.from([0xff, 0xfe, 0x01]),
		Buffer.from("return 1", "utf16le"),
	])
		assert.throws(() => decodeText(bytes, "fixture"), /Cannot decode fixture/);
});
test("author preview reads a PowerShell-style UTF-16 plan and source without Studio", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-encoding-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const plan = {
		version: 1,
		name: "Unicode source",
		operations: [{ op: "script", path: "ReplicatedStorage.Proof", sourceFile: "source.luau" }],
	};
	const source = "-- café 🦖\r\nreturn 42\r\n";
	fs.writeFileSync(path.join(root, "plan.json"), Buffer.from("\uFEFF" + JSON.stringify(plan), "utf16le"));
	fs.writeFileSync(path.join(root, "source.luau"), Buffer.from("\uFEFF" + source, "utf16le"));
	const output = path.join(root, "review.json");
	const result = spawnSync(
		process.execPath,
		[path.join(__dirname, "studio-author.cjs"), "preview", path.join(root, "plan.json"), "--out", output],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readJson(output).plan.operations[0].source, source.replaceAll("\r\n", "\n"));
});
