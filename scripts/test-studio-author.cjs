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
const { validatePlan, luaString, compile, decodeResult, run, hash } = require("./studio-author.cjs");
const plan = () => ({
	version: 1,
	name: "Tooling test",
	operations: [
		{ op: "create", path: "Workspace.ToolingTest", className: "Model" },
		{
			op: "create",
			path: "Workspace.ToolingTest.Block",
			className: "Part",
			properties: { Anchored: true, Size: { type: "Vector3", value: [2, 3, 4] } },
		},
	],
});
const studio = { id: "session-a" };
function peer(handler) {
	const calls = [];
	return {
		calls,
		async call(name, args) {
			assert.equal(name, "execute_luau");
			assert.equal(args.datamodel_type, "Edit");
			const firstLine = args.code.split("\n")[0];
			const match = firstLine.match(/JSONDecode\(\[(=*)\[([\s\S]*)\]\1\]\)/);
			assert.ok(match);
			const request = JSON.parse(match[2]);
			calls.push(request);
			return handler(request, args);
		},
	};
}
const response = (value) => ({
	text: JSON.stringify({ robloxStudio: 1, ok: true, placeId: "123", ...value }),
});
test("normalizes plan paths and accepts typed world properties", () => {
	const input = plan();
	input.operations[0].path = "game.Workspace.ToolingTest";
	const parsed = validatePlan(input);
	assert.equal(parsed.operations[0].path, "Workspace.ToolingTest");
	assert.equal(parsed.operations[1].properties.Size.value[1], 3);
});
test("blocks generated sources, service roots, ambiguous names, and unsupported operations", () => {
	for (const target of [
		"ServerScriptService.TS.main",
		"ReplicatedStorage.rbxts_include.RuntimeLib",
		"Workspace",
		"Workspace..Part",
		"Workspace.P[1]",
	]) {
		const input = plan();
		input.operations[0].path = target;
		assert.throws(() => validatePlan(input));
	}
	const input = plan();
	input.operations[0].op = "delete";
	assert.throws(() => validatePlan(input), /Supported operations/);
});
test("rejects duplicate targets, protected properties, invalid types and excessive batches", () => {
	const duplicate = plan();
	duplicate.operations.push(duplicate.operations[0]);
	assert.throws(() => validatePlan(duplicate), /one operation/);
	for (const prop of ["Source", "Parent", "Name", "ClassName"]) {
		const input = plan();
		input.operations[0].properties = { [prop]: "x" };
		assert.throws(() => validatePlan(input), /Protected/);
	}
	for (const val of [
		null,
		[],
		{ type: "Vector3", value: [1, 2] },
		{ type: "Enum", enum: "Material;bad", name: "Neon" },
		Infinity,
	]) {
		const input = plan();
		input.operations[0].properties = { Color: val };
		assert.throws(() => validatePlan(input));
	}
	const input = plan();
	input.operations = Array(51).fill(input.operations[0]);
	assert.throws(() => validatePlan(input), /1..50/);
});
test("embeds source as data even when it contains Lua delimiters or injection text", () => {
	const source = ']] ]=] ]==] \\n"; error("injected") -- 😀';
	const input = {
		version: 1,
		name: "Source test",
		operations: [{ op: "script", path: "ServerScriptService.AuthorTest", source }],
	};
	const normalized = validatePlan(input);
	const code = compile({ action: "inspect", plan: normalized });
	assert.ok(code.includes(JSON.stringify(source)));
	assert.equal(luaString("a]]b]=]c"), "[==[a]]b]=]c]==]");
	for (const value of ["[]", '[{"x":[1,2]}]', "a]", "a]=", "a]]b]=]c]"]) {
		const quoted = luaString(value),
			opening = quoted.match(/^\[(=*)\[/)[0];
		const closer = "]" + quoted.match(/^\[(=*)\[/)[1] + "]";
		assert.equal(quoted.indexOf(closer, opening.length), opening.length + value.length);
		assert.equal(quoted.slice(opening.length, -closer.length), value);
	}
});
test("source files resolve relative to the plan and become frozen review content", (t) => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-author-"));
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	fs.writeFileSync(path.join(temp, "source.luau"), "\uFEFFreturn 42\r\n");
	const normalized = validatePlan(
		{
			version: 1,
			name: "File",
			operations: [{ op: "script", path: "ReplicatedStorage.Test", sourceFile: "source.luau" }],
		},
		temp,
	);
	assert.equal(normalized.operations[0].source, "return 42\n");
	assert.equal(normalized.operations[0].sourceFile, undefined);
});

test("inline CRLF and CR sources normalize before freezing, but old CRLF reviews cannot mutate", async () => {
	const input = {
		version: 1,
		name: "Line endings",
		operations: [{ op: "script", path: "ReplicatedStorage.Test", source: "\uFEFF-- test\r\nreturn 42\r" }],
	};
	const canonical = validatePlan(input);
	assert.equal(canonical.operations[0].source, "-- test\nreturn 42\n");
	const client = peer(() => response({ before: [{ exists: true, source: "return 1\n" }] }));
	const review = await run(client, studio, "inspect", input);
	assert.equal(review.plan.operations[0].source, canonical.operations[0].source);
	review.plan.operations[0].source = "return 42\r\n";
	const { digest: _digest, ...body } = review;
	review.digest = hash(body);
	client.calls.length = 0;
	await assert.rejects(run(client, studio, "apply", review), /line endings/);
	assert.equal(client.calls.length, 0);
});
test("recognizes nested execution results and fails closed on semantic failures", () => {
	assert.equal(decodeResult({ result: { text: JSON.stringify({ robloxStudio: 1, ok: true }) } }).ok, true);
	assert.throws(() => decodeResult({ text: "permission denied" }), /Unrecognized/);
	assert.throws(() => decodeResult({ robloxStudio: 1, ok: false, error: "Conflict" }), /Conflict/);
});
test("inspection captures source snapshots without sending a mutation", async () => {
	const client = peer((request) => {
		assert.equal(request.action, "inspect");
		return response({ before: [{ exists: false }, { exists: false }] });
	});
	const review = await run(client, studio, "inspect", plan());
	const { digest, ...body } = review;
	assert.equal(digest, hash(body));
	assert.equal(client.calls.length, 1);
});
test("apply refuses modified reviews or different Studio sessions before any tool call", async () => {
	const client = peer(() => response({ before: [{ exists: false }, { exists: false }] }));
	const review = await run(client, studio, "inspect", plan());
	client.calls.length = 0;
	await assert.rejects(run(client, { id: "session-b" }, "apply", review), /session changed/);
	review.plan.name = "Changed";
	await assert.rejects(run(client, studio, "apply", review), /Review changed/);
	assert.equal(client.calls.length, 0);
});
test("writes recovery journal before mutation and records successful outcomes", async (t) => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-author-"));
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	const client = peer((request) => {
		if (request.action === "inspect") return response({ before: [{ exists: false }, { exists: false }] });
		const files = fs.readdirSync(temp);
		assert.equal(files.length, 1);
		assert.equal(JSON.parse(fs.readFileSync(path.join(temp, files[0]), "utf8")).status, "pending");
		return response({ changed: ["Workspace.ToolingTest"] });
	});
	const review = await run(client, studio, "inspect", plan());
	const result = await run(client, studio, "apply", review, { journalDir: temp });
	assert.equal(result.captureRequired, true);
	assert.equal(JSON.parse(fs.readFileSync(result.journalPath)).status, "applied");
});
test("a timeout keeps the journal unconfirmed and never automatically retries", async (t) => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-author-"));
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	const client = peer((request) => {
		if (request.action === "inspect") return response({ before: [{ exists: false }, { exists: false }] });
		throw Error("Timeout");
	});
	const review = await run(client, studio, "inspect", plan());
	await assert.rejects(
		run(client, studio, "apply", review, { journalDir: temp }),
		/Inspect Studio before retrying/,
	);
	assert.equal(client.calls.filter((c) => c.action === "apply").length, 1);
	assert.equal(JSON.parse(fs.readFileSync(path.join(temp, fs.readdirSync(temp)[0]))).status, "unconfirmed");
});
