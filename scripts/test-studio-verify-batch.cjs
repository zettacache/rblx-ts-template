const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prepare, validatePrepared, run } = require("./studio-verify-batch.cjs");
const ROOT = path.resolve(__dirname, "..");

function fixture(t, secondCode = 'console.log("second")') {
	const parent = path.join(ROOT, "build", "batch-regression");
	fs.mkdirSync(parent, { recursive: true });
	const directory = fs.mkdtempSync(path.join(parent, "case-"));
	// The exact owned temporary directory is resolved beneath the test parent.
	assert(path.resolve(directory).startsWith(path.resolve(parent) + path.sep));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	fs.writeFileSync(path.join(directory, "cleanup.luau"), 'return "fixture-only"');
	fs.writeFileSync(path.join(directory, "input.txt"), "initial");
	const source = path.relative(ROOT, path.join(directory, "input.txt")).replaceAll("\\", "/");
	const steps = ["first", "second"].map((name, index) => {
		const script = path.join(directory, name + ".cjs");
		fs.writeFileSync(script, index === 0 ? 'console.log("first");' : secondCode);
		const plan = path.join(directory, name + ".json");
		fs.writeFileSync(
			plan,
			JSON.stringify({
				operation: name,
				command: ["node", script],
				cleanupProbe: "cleanup.luau",
				sourceStable: true,
				sourceFiles: [source],
			}),
		);
		return { name, plan, evidence: "edit-engine" };
	});
	const manifest = path.join(directory, "manifest.json");
	fs.writeFileSync(manifest, JSON.stringify({ version: 1, operation: "batch-fixture", steps }));
	const record = {
		token: "fixture-token",
		owner: "fixture-owner",
		task: "fixture-task",
		projectId: "123",
		studioId: "fixture-studio",
		checkout: ROOT,
	};
	const live = new Set();
	const hooks = {
		root: ROOT,
		record,
		assertOwnership: () => ({ ...record }),
		processApi: {
			register(pid) {
				live.add(pid);
				return pid;
			},
			finish(pid) {
				assert(live.delete(pid));
			},
		},
		afterStep: async () => {},
		progress: () => {},
		gateTimeoutMs: 150,
	};
	return { directory, manifest, steps, hooks, live, source, output: path.join(directory, "output") };
}

test("prepare is offline, scopes the union and reports intentionally omitted steps", (t) => {
	const f = fixture(t);
	const result = prepare(f.manifest, f.output, { only: ["second"] });
	assert.deepEqual(result.selected, ["second"]);
	assert.deepEqual(result.omitted, ["first"]);
	const plan = JSON.parse(fs.readFileSync(result.turn));
	assert(plan.sourceFiles.includes(f.source));
	assert(plan.sourceFiles.includes(path.relative(ROOT, result.batch).replaceAll("\\", "/")));
	assert.equal(fs.existsSync(path.join(f.output, "second.log")), false);
});

test("ready batch runs serially with PID handshakes, log files and per-step cleanup", async (t) => {
	const f = fixture(t);
	let cleanups = 0;
	f.hooks.afterStep = async () => {
		assert.equal(f.live.size, 0);
		cleanups++;
	};
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, true);
	assert.deepEqual(
		result.steps.map((step) => step.name),
		["first", "second"],
	);
	assert.equal(cleanups, 2);
	assert.equal(f.live.size, 0);
	assert.match(fs.readFileSync(result.steps[0].log, "utf8"), /first/);
	assert.deepEqual(result.notRun, []);
});

test("a failing command stops later checks without retrying or inventing success", async (t) => {
	const f = fixture(t);
	fs.writeFileSync(path.join(f.directory, "first.cjs"), "process.exitCode=7;");
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.equal(result.steps.length, 1);
	assert.deepEqual(result.notRun, ["second"]);
	assert.equal(fs.existsSync(path.join(f.output, "second.log")), false);
});

test("cleanup failure stops the batch and all child exits are recorded", async (t) => {
	const f = fixture(t);
	f.hooks.afterStep = async () => {
		throw Error("owned fixture remains");
	};
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.match(result.error, /owned fixture/);
	assert.equal(result.steps[0].cleanupPassed, false);
	assert.equal(f.live.size, 0);
	assert.deepEqual(result.notRun, ["second"]);
});

test("failed PID registration leaves the launch gate shut and never executes fixture code", async (t) => {
	const f = fixture(t);
	const marker = path.join(f.directory, "unexpected.txt");
	fs.writeFileSync(
		path.join(f.directory, "first.cjs"),
		'require("fs").writeFileSync(' + JSON.stringify(marker) + ',"bad")',
	);
	f.hooks.processApi.register = () => {
		throw Error("receipt refused");
	};
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.match(result.error, /receipt refused/);
	assert.equal(fs.existsSync(marker), false);
});

test("prepared input drift and author plans are rejected before executing commands", async (t) => {
	const f = fixture(t);
	const prepared = prepare(f.manifest, f.output);
	fs.appendFileSync(path.join(f.directory, "first.cjs"), "\n// changed");
	assert.throws(() => validatePrepared(prepared.batch, ROOT), /Prepared input changed/);
	const plan = JSON.parse(fs.readFileSync(f.steps[1].plan));
	plan.sourceStable = false;
	delete plan.sourceFiles;
	fs.writeFileSync(f.steps[1].plan, JSON.stringify(plan));
	assert.throws(() => prepare(f.manifest, path.join(f.directory, "new-output")), /Author\/import/);
});

test("scoped input changes during a step invalidate it before the next step starts", async (t) => {
	const f = fixture(t);
	f.hooks.afterStep = async () => fs.writeFileSync(path.join(ROOT, f.source), "changed");
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.match(result.error, /Source changed/);
	assert.deepEqual(result.notRun, ["second"]);
});

test("a full-source child keeps the parent full-source and a scoped child cannot narrow it", (t) => {
	const f = fixture(t);
	const plan = JSON.parse(fs.readFileSync(f.steps[1].plan));
	delete plan.sourceFiles;
	fs.writeFileSync(f.steps[1].plan, JSON.stringify(plan));
	const result = prepare(f.manifest, f.output);
	assert.equal(JSON.parse(fs.readFileSync(result.turn)).sourceFiles, undefined);
});

test("soft budget stops later checks after the current child exits safely", async (t) => {
	const f = fixture(t);
	const manifest = JSON.parse(fs.readFileSync(f.manifest));
	manifest.maxDurationMs = 1000;
	fs.writeFileSync(f.manifest, JSON.stringify(manifest));
	f.hooks.afterStep = async () => new Promise((resolve) => setTimeout(resolve, 1050));
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.match(result.error, /soft budget/);
	assert.equal(f.live.size, 0);
	assert.deepEqual(result.notRun, ["second"]);
});

test("last-step fixture or cleanup mutation cannot become a successful receipt", async (t) => {
	const f = fixture(t);
	f.hooks.afterStep = async (step) => {
		if (step.name === "second") fs.appendFileSync(path.join(f.directory, "cleanup.luau"), "\n-- changed");
	};
	const result = await run(prepare(f.manifest, f.output).batch, f.hooks);
	assert.equal(result.commandPassed, false);
	assert.match(result.error, /Prepared input changed/);
	assert.equal(result.steps[1].cleanupPassed, false);
});

test("an output receipt is exclusively claimed before a fixture starts", async (t) => {
	const f = fixture(t);
	const prepared = prepare(f.manifest, f.output);
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	f.hooks.afterStep = async () => held;
	const first = run(prepared.batch, f.hooks);
	await assert.rejects(run(prepared.batch, f.hooks), /Batch already ran/);
	release();
	assert.equal((await first).commandPassed, true);
});
