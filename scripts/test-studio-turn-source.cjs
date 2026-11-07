const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { sourceEvidence, validateSourceFiles, PINNED_FILES } = require("./studio-turn-source.cjs");
const { readPlan, sourceVersion } = require("./studio-turn.cjs");

function fixture(t) {
	const temporary = path.resolve(__dirname, "../build/test-turn-source");
	fs.mkdirSync(temporary, { recursive: true });
	const root = fs.mkdtempSync(path.join(temporary, "fixture-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const put = (file, value = file) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), value);
	};
	for (const file of [
		...PINNED_FILES,
		"studio/a.luau",
		"src/a.ts",
		"scripts/fixture.luau",
		"assets/mesh.bin",
		"out/shared/compiled.luau",
	])
		put(file);
	return { root, put };
}

test("unscoped source and plan digests retain their historical byte identity", (t) => {
	const { root, put } = fixture(t);
	const oldSnapshot = require("./tooling-snapshot.cjs").snapshot(root);
	const oldVersion = crypto.createHash("sha256").update(JSON.stringify(oldSnapshot)).digest("hex");
	assert.equal(sourceVersion(root), oldVersion);
	put("cleanup.luau", "return {clean=true}");
	const file = path.join(root, "plan.json");
	const raw = { operation: "check", command: ["node", "check.cjs"], cleanupProbe: "cleanup.luau" };
	put("plan.json", JSON.stringify(raw));
	const previousPlan = {
		...raw,
		cleanupProbe: path.join(root, "cleanup.luau"),
		cleanupSource: "return {clean=true}",
	};
	assert.equal(
		readPlan(file).digest,
		crypto.createHash("sha256").update(JSON.stringify(previousPlan)).digest("hex"),
	);
	put("out/shared/compiled.luau", "new compiled");
	put("studio-tools.json", "new configuration");
	assert.notEqual(
		sourceVersion(root),
		oldVersion,
		"configuration drift remains part of the template full fingerprint",
	);
});

test("explicit scope includes fixtures, assets and compiled files, and ignores unrelated sources", (t) => {
	const { root, put } = fixture(t);
	const plan = { sourceFiles: ["scripts/fixture.luau", "assets/mesh.bin", "out/shared/compiled.luau"] };
	const before = sourceEvidence(root, plan);
	assert.equal(before.mode, "explicit-files");
	assert.deepEqual(Object.keys(before.files).sort(), [...plan.sourceFiles, ...PINNED_FILES].sort());
	assert(Object.values(before.files).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
	put("studio/a.luau", "unrelated revision");
	put("src/unrelated.ts", "new source");
	assert.deepEqual(sourceEvidence(root, plan), before);
	for (const file of plan.sourceFiles) {
		const current = sourceEvidence(root, plan);
		put(file, "changed " + file);
		assert.notEqual(sourceEvidence(root, plan).version, current.version, file);
	}
});

test("each pinned mapping/configuration changes the scope identity and removal fails closed", (t) => {
	const { root, put } = fixture(t);
	const plan = { sourceFiles: ["scripts/fixture.luau", "default.project.json"] };
	for (const file of PINNED_FILES) {
		const before = sourceEvidence(root, plan);
		put(file, "changed " + file);
		assert.notEqual(sourceEvidence(root, plan).version, before.version, file);
		fs.unlinkSync(path.join(root, file));
		assert.throws(() => sourceEvidence(root, plan), /missing, unsafe/);
		put(file);
	}
	fs.unlinkSync(path.join(root, "scripts/fixture.luau"));
	assert.throws(() => sourceEvidence(root, plan), /scripts\/fixture.luau.*missing/);
});

test("scope rejects empty, duplicate, absolute, glob, traversal and non-regular file inputs", (t) => {
	const { root, put } = fixture(t);
	for (const sourceFiles of [
		null,
		[],
		"studio/a.luau",
		["studio/a.luau", "STUDIO/a.luau"],
		["studio/a.luau", "studio\\a.luau"],
		["/tmp/outside"],
		["C:/outside"],
		["../outside"],
		["studio/../outside"],
		["./studio/a.luau"],
		["studio//a.luau"],
		["studio/*.luau"],
		["studio/a?.luau"],
		["studio/[a].luau"],
		["studio/{a}.luau"],
		["studio/a.luau:stream"],
		["studio/a.luau "],
	]) {
		assert.throws(() => validateSourceFiles(sourceFiles), /sourceFiles/, JSON.stringify(sourceFiles));
	}
	assert.throws(() => sourceEvidence(root, { sourceFiles: ["studio"] }), /regular file/);
	assert.throws(() => sourceEvidence(root, { sourceFiles: ["missing"] }), /missing/);
	assert.throws(
		() => sourceEvidence(root, { sourceFiles: ["studio/a.luau"], sourceStable: false }),
		/sourceStable:false/,
	);
	put("cleanup.luau", "return {}");
	put(
		"bad-plan.json",
		JSON.stringify({
			operation: "x",
			command: ["node"],
			cleanupProbe: "cleanup.luau",
			sourceFiles: [],
			sourceStable: true,
		}),
	);
	assert.throws(() => readPlan(path.join(root, "bad-plan.json")), /nonempty/);
});

test("resolved ancestors cannot take a scoped file outside the repository (injected filesystem observation)", (t) => {
	const { root } = fixture(t);
	const realpath = fs.realpathSync;
	const file = path.join(root, "scripts/fixture.luau");
	t.mock.method(fs, "realpathSync", (value) =>
		path.resolve(value) === file ? path.resolve(root, "../outside/file.luau") : realpath(value),
	);
	assert.throws(() => sourceEvidence(root, { sourceFiles: ["scripts/fixture.luau"] }), /junction escape/);
});

test("a native directory junction cannot take a scoped file outside the repository", (t) => {
	const { root } = fixture(t);
	const outside = fs.mkdtempSync(path.resolve(root, "../outside-"));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.writeFileSync(path.join(outside, "escape.luau"), "outside");
	// Junctions work without Windows symlink privileges. The scoped validator must
	// check the resolved ancestor, not only the leaf's regular-file stat.
	try {
		fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		if (error.code === "EPERM" || error.code === "EACCES")
			return t.skip(
				"Runtime does not permit creating a native symlink/junction; injected observation test still covers rejection.",
			);
		throw error;
	}
	assert.throws(() => sourceEvidence(root, { sourceFiles: ["escape/escape.luau"] }), /escape/);
});
