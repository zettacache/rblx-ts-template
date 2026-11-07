const fs = require("node:fs"),
	path = require("node:path"),
	test = require("node:test"),
	assert = require("node:assert/strict");
const { registerProcess, finishProcess, assertManagedProcessesStopped } = require("./studio-turn.cjs");
test("managed process receipts enforce identity and preserve session registrations", (t) => {
	const root = path.resolve(__dirname, ".."),
		parent = path.join(root, "build/managed-regression");
	fs.mkdirSync(parent, { recursive: true });
	const dir = fs.mkdtempSync(path.join(parent, "case-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "turn.json");
	const record = {
		file,
		checkout: root,
		token: "fixture-token",
		owner: "fixture-owner",
		task: "fixture-task",
		studioId: "fixture-studio",
		projectId: "123",
		sessions: [],
	};
	fs.writeFileSync(file, JSON.stringify(record));
	const values = {
		STUDIO_TURN_RECORD: file,
		STUDIO_RESERVATION_TOKEN: record.token,
		STUDIO_RESERVATION_OWNER: record.owner,
		STUDIO_RESERVATION_TASK: record.task,
		STUDIO_RESERVATION_STUDIO: record.studioId,
		STUDIO_RESERVATION_PROJECT: record.projectId,
	};
	const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
	Object.assign(process.env, values);
	t.after(() => {
		for (const [k, v] of Object.entries(before))
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
	});
	const id = registerProcess(process.pid, "fixture");
	require("./studio-turn.cjs").registerSession(path.join(dir, "session.json"));
	assert.throws(() => assertManagedProcessesStopped(JSON.parse(fs.readFileSync(file))), /alive/);
	finishProcess(id, { exitCode: 0 });
	finishProcess(id, { exitCode: 0 });
	const updated = JSON.parse(fs.readFileSync(file));
	assert.equal(updated.sessions.length, 1);
	assert.equal(updated.managedProcesses[0].state, "exited");
	assertManagedProcessesStopped(updated);
	assert.throws(() => finishProcess(id, { exitCode: 1 }), /mismatch/);
	process.env.STUDIO_RESERVATION_TOKEN = "other";
	assert.throws(() => registerProcess(1, "bad"), /ownership mismatch/);
});
