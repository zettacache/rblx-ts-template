const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { batch } = require("./blender-batch.cjs");
function fixture(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blender-batch-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, "recipe.py"), "pass");
	for (const name of ["A", "B", "C"])
		fs.writeFileSync(
			path.join(dir, name + ".json"),
			JSON.stringify({ version: 1, name, script: "recipe.py" }),
		);
	const file = path.join(dir, "batch.json");
	fs.writeFileSync(file, JSON.stringify({ version: 1, jobs: ["A.json", "B.json", "C.json"] }));
	return { dir, file };
}
test("batch bounds concurrency, shares executable probe and keeps input order in reports", async (t) => {
	const f = fixture(t);
	let active = 0,
		peak = 0,
		probes = 0;
	const result = await batch(
		f.file,
		{ jobs: 2, profile: "preview", reuse: true },
		{
			executable: "mock",
			executableIdentity: () => {
				probes++;
				return { version: "fixture" };
			},
			reportRoot: f.dir,
			run: async (file, options, runtime) => {
				active++;
				peak = Math.max(peak, active);
				assert.equal(options.profile, "preview");
				assert.equal(options.reuse, true);
				assert.equal(runtime.executableIdentity().version, "fixture");
				await new Promise((resolve) => setTimeout(resolve, 15));
				active--;
				return { output: file + ".out", cache: { reused: true } };
			},
		},
	);
	assert.equal(probes, 1);
	assert.equal(peak, 2);
	assert.equal(result.ok, true);
	assert.deepEqual(
		result.results.map((row) => path.basename(row.job)),
		["A.json", "B.json", "C.json"],
	);
	assert.equal(JSON.parse(fs.readFileSync(result.reportFile)).ok, true);
});
test("preflight rejects all work before launch and records individual worker failures", async (t) => {
	const f = fixture(t);
	let launches = 0;
	const runtime = {
		executable: "mock",
		reportRoot: f.dir,
		executableIdentity: () => ({}),
		run: async () => {
			launches++;
			throw Error("fixture failure");
		},
	};
	await assert.rejects(batch(f.file, { jobs: 8 }, runtime), /1..4/);
	assert.equal(launches, 0);
	const result = await batch(f.file, {}, runtime);
	assert.equal(result.ok, false);
	assert.equal(result.results.length, 3);
	assert.equal(launches, 3);
	fs.writeFileSync(path.join(f.dir, "C.json"), "{}");
	await assert.rejects(batch(f.file, {}, runtime), /version/);
	assert.equal(launches, 3);
});
