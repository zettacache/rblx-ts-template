// Isolated test process: fictitious place, never a live upload target.
const injectedConfig = require("./studio-config.cjs");
const originalReadConfig = injectedConfig.read;
injectedConfig.read = (root) =>
	!root || require("node:path").resolve(root) === require("node:path").resolve(__dirname, "..")
		? { expectedPlaceId: "123456789" }
		: originalReadConfig(root);
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { McpClient } = require("./studio-mcp-client.cjs");
const { parse, chooseStudio, main } = require("./studio.cjs");
const fs = require("node:fs"),
	os = require("node:os");
const { schemas } = require("./studio-schemas.cjs");

const mock = path.join(__dirname, "fixtures", "mock-studio-mcp.cjs");
// Explicit mock-only transport injection; production McpClient always guards calls.
const mockGuard = (_name, _args, send) => send();
const studios = {
	studios: [
		{ id: "a", name: "Project (placeId: 123)" },
		{ id: "b", name: "Other (placeId: 456)" },
	],
};

test("selects the configured place, not the first Studio", () => {
	assert.equal(chooseStudio(studios, undefined, "456").id, "b");
	assert.equal(chooseStudio(studios, "a", "456").id, "a");
});

test("rejects missing and ambiguous targets", () => {
	assert.throws(() => chooseStudio(studios, undefined, "45"), /uniquely/);
	assert.throws(() => chooseStudio(studios, undefined, undefined), /uniquely/);
	assert.throws(() => chooseStudio(studios, "missing", "123"), /not connected/);
	assert.throws(() => chooseStudio({ studios: [] }, undefined, "123"), /uniquely/);
});

test("an unconfigured template never selects even a single open Studio", () => {
	const one = { studios: [studios.studios[0]] };
	assert.throws(() => chooseStudio(one, undefined, null), /Configure expectedPlaceId/);
	assert.equal(chooseStudio(one, "a", null).id, "a");
	assert.throws(() => chooseStudio(one, undefined, "123.*"), /numeric place ID/);
});

test("parses paths without evaluating shell syntax and rejects unknown options", () => {
	assert.deepEqual(parse(["inspect", "Workspace.A $()", "--context", "Edit"]), {
		command: "inspect",
		target: "Workspace.A $()",
		options: { context: "Edit" },
	});
	assert.throws(() => parse(["tree", "--limit"]), /Missing value/);
	assert.throws(() => parse(["tree", "--unknown"]), /Unknown option/);
});

test("stdio initialization and concurrent requests route responses by ID", async () => {
	const client = new McpClient(process.execPath, [mock], 3000, { guard: mockGuard });
	try {
		assert.equal((await client.connect()).serverInfo.name, "mock");
		const result = await Promise.all([client.call("query", { id: 1 }), client.call("query", { id: 2 })]);
		assert.deepEqual(result, [{ received: { id: 1 } }, { received: { id: 2 } }]);
	} finally {
		client.close();
	}
});

test("tool and protocol errors propagate as failures", async () => {
	const client = new McpClient(process.execPath, [mock], 3000, { guard: mockGuard });
	try {
		await client.connect();
		await assert.rejects(client.call("broken"), /Invalid instance/);
		await assert.rejects(client.request("rpc-error"), /Unknown method/);
	} finally {
		client.close();
	}
});

test("timeouts and bridge crashes reject instead of hanging", async () => {
	const client = new McpClient(process.execPath, [mock], 3000, { guard: mockGuard });
	try {
		await client.connect();
		client.timeoutMs = 80;
		await assert.rejects(client.request("hang"), /Timed out/);
		client.timeoutMs = 3000;
		await assert.rejects(client.request("crash"), /exited \(7\)/);
	} finally {
		client.close();
	}
});

test("missing bridge executable reports launch failure", async () => {
	const client = new McpClient(path.join(__dirname, "no-such-studio-bridge.exe"), [], 1000);
	try {
		await assert.rejects(client.connect(), /ENOENT/);
	} finally {
		client.close();
	}
});

test("saved output stays complete while stdout is compact; full output remains available", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-cli-output-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const output = path.join(dir, "result.json");
	const payload = { text: "large source ".repeat(1000) };
	let closed = 0;
	const client = {
		async connect() {
			return {};
		},
		close() {
			closed++;
		},
		async call(name, args) {
			if (name === "list_roblox_studios")
				return {
					studios: [{ id: "a", name: "placeId: " + require("./studio-config.cjs").read().expectedPlaceId }],
				};
			assert.equal(name, "skill");
			assert.deepEqual(args, { studio_id: "a", skill_name: "device-skill" });
			return payload;
		},
	};
	let stdout = "";
	await main(["skill", "device-skill", "--out", output, "--raw"], {
		client,
		write: (value) => {
			stdout += value;
		},
	});
	assert.deepEqual(JSON.parse(fs.readFileSync(output)), payload);
	assert.equal(JSON.parse(stdout).bytes, fs.statSync(output).size);
	assert.ok(stdout.length < 500);
	stdout = "";
	await main(["skill", "device-skill", "--out", output, "--raw", "--full"], {
		client,
		write: (value) => {
			stdout += value;
		},
	});
	assert.deepEqual(JSON.parse(stdout), payload);
	assert.equal(closed, 2);
});

test("exact schema filtering traverses pages and unknown tools fail with cleanup", async () => {
	let closed = 0,
		stdout = "";
	const client = {
		async connect() {
			return {};
		},
		close() {
			closed++;
		},
		async request(name, args) {
			assert.equal(name, "tools/list");
			return args.cursor
				? { tools: [{ name: "screen_capture", inputSchema: { type: "object" } }] }
				: { tools: [{ name: "other" }], nextCursor: "second" };
		},
	};
	await main(["tools", "screen_capture", "--raw"], {
		client,
		write: (value) => {
			stdout += value;
		},
	});
	assert.deepEqual(
		JSON.parse(stdout).map((tool) => tool.name),
		["screen_capture"],
	);
	await assert.rejects(main(["tools", "missing"], { client }), /Tool not found/);
	assert.equal(closed, 2);
});

test("timings identify tools and contexts without persisting source, arguments, responses or tokens", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-timing-"));
	t.after(() => {
		assert.equal(path.dirname(dir), os.tmpdir());
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const trace = path.join(dir, "calls.jsonl");
	const client = new McpClient(process.execPath, [mock], 3000, { guard: mockGuard, tracePath: trace });
	try {
		await client.connect();
		await client.call("query", { datamodel_type: "Client", code: "PRIVATE_SOURCE", token: "PRIVATE_TOKEN" });
		await assert.rejects(client.call("broken"), /Invalid instance/);
		client.timeoutMs = 25;
		await assert.rejects(
			client.call("delayed", { datamodel_type: "Server", code: "PRIVATE_SOURCE" }),
			(e) => {
				assert.equal(e.code, "STUDIO_MCP_TIMEOUT");
				assert.match(e.message, /tools\/call \/ delayed \/ Server/);
				return true;
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 160)); // Late response must not add a second timing.
		const rows = client.timingSummary();
		assert.equal(rows.find((x) => x.tool === "query").count, 1);
		assert.equal(rows.find((x) => x.tool === "broken").failures, 1);
		assert.equal(rows.find((x) => x.tool === "delayed").timeouts, 1);
		assert.equal(rows.find((x) => x.tool === "delayed").count, 1);
		assert(rows.every((x) => x.totalMs >= 0 && x.maxMs >= x.meanMs));
		const text = fs.readFileSync(trace, "utf8");
		assert.doesNotMatch(text, /PRIVATE_|Invalid instance|received/);
		assert.equal(text.trim().split("\n").length, 4);
	} finally {
		client.close();
	}
});

test("trace write failure cannot turn a successful call into an ambiguous mutation", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-trace-failure-"));
	t.after(() => {
		assert.equal(path.dirname(dir), os.tmpdir());
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const block = path.join(dir, "file");
	fs.writeFileSync(block, "not a directory");
	let warnings = 0;
	const client = new McpClient(process.execPath, [mock], 3000, {
		guard: mockGuard,
		tracePath: path.join(block, "trace"),
		traceWarning() {
			warnings++;
		},
	});
	try {
		await client.connect();
		assert.deepEqual(await client.call("query", { id: 3 }), { received: { id: 3 } });
		assert.equal(warnings, 1);
	} finally {
		client.close();
	}
});

test("session schema cache shares discovery, invalidates on native notification and rejects a closed bridge", async () => {
	const client = new McpClient(process.execPath, [mock], 3000, { guard: mockGuard });
	try {
		await client.connect();
		const [a, b] = await Promise.all([schemas(client), schemas(client)]);
		assert(a.has("query"));
		assert(b.has("query"));
		a.clear();
		assert((await schemas(client)).has("query"));
		assert.equal(client.timingSummary().find((x) => x.method === "tools/list").count, 1);
		await client.request("notify-tools-changed");
		await schemas(client);
		assert.equal(client.timingSummary().find((x) => x.method === "tools/list").count, 2);
	} finally {
		client.close();
	}
	await assert.rejects(schemas(client), /closed/);
});

test("schema cache never retains a failed, looping or notification-invalidated discovery", async () => {
	let calls = 0,
		fail = true;
	const client = {
		async request(_method, args) {
			calls++;
			if (fail) throw Error("discovery failed");
			return args.cursor
				? { tools: [{ name: "second", inputSchema: {} }] }
				: { tools: [{ name: "first", inputSchema: {} }], nextCursor: "page2" };
		},
	};
	await assert.rejects(schemas(client), /discovery failed/);
	fail = false;
	assert.equal((await schemas(client)).size, 2);
	await schemas(client);
	assert.equal(calls, 3);
	const loop = {
		async request() {
			return { tools: [], nextCursor: "same" };
		},
	};
	await assert.rejects(schemas(loop), /repeated/);
	const changing = {
		toolListVersion: 0,
		async request() {
			this.toolListVersion++;
			return { tools: [] };
		},
	};
	await assert.rejects(schemas(changing), /changed during/);
});
