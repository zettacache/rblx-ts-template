#!/usr/bin/env node
// First-party authoring over the installed Roblox bridge; no RoPilot dependency.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readText, readJson } = require("./text-files.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { decodeResult } = require("./studio-result.cjs");
const ROOT = path.resolve(__dirname, "..");
const SERVICES = new Set([
	"Workspace",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Lighting",
	"SoundService",
	"MaterialService",
]);
const CLASSES = new Set([
	"Folder",
	"Model",
	"Part",
	"WedgePart",
	"CornerWedgePart",
	"Attachment",
	"PointLight",
	"SpotLight",
	"SurfaceLight",
	"Script",
	"LocalScript",
	"ModuleScript",
	"RemoteEvent",
	"RemoteFunction",
	"BindableEvent",
	"BindableFunction",
	"ScreenGui",
	"SurfaceGui",
	"BillboardGui",
	"Frame",
	"TextLabel",
	"TextButton",
	"TextBox",
	"ImageLabel",
	"ImageButton",
	"ScrollingFrame",
	"UICorner",
	"UIStroke",
	"UIListLayout",
	"UIGridLayout",
	"UIPadding",
	"UIScale",
	"Tool",
	"ProximityPrompt",
	"Animation",
]);
const TYPES = { Vector3: 3, Color3: 3, CFrame: [3, 12], Vector2: 2, UDim: 2, UDim2: 4 };
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function instancePath(value) {
	if (typeof value !== "string") throw Error("Instance path must be a string.");
	const parts = value.replace(/^game\./, "").split(".");
	if (!SERVICES.has(parts[0]) || parts.length < 2 || parts.some((p) => !/^[A-Za-z_][A-Za-z0-9_ -]*$/.test(p)))
		throw Error(`Invalid authoring path: ${value}`);
	if (parts.some((p) => ["TS", "rbxts_include"].includes(p)))
		throw Error("Generated TS/runtime paths are protected; edit src/ instead.");
	return parts.join(".");
}
function valueCheck(value) {
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	)
		return;
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Use scalar values or tagged Roblox values.");
	if (
		value.type === "Enum" &&
		/^[A-Za-z][A-Za-z0-9]*$/.test(value.enum) &&
		/^[A-Za-z][A-Za-z0-9]*$/.test(value.name)
	)
		return;
	const count = TYPES[value.type];
	if (
		!count ||
		!Array.isArray(value.value) ||
		!(Array.isArray(count) ? count : [count]).includes(value.value.length) ||
		!value.value.every((n) => typeof n === "number" && Number.isFinite(n))
	)
		throw Error("Invalid tagged Roblox value.");
}
function validatePlan(input, base = ROOT) {
	if (
		!input ||
		input.version !== 1 ||
		typeof input.name !== "string" ||
		!input.name.trim() ||
		input.name.length > 100 ||
		!Array.isArray(input.operations) ||
		input.operations.length < 1 ||
		input.operations.length > 50
	)
		throw Error("Plan needs version:1, name, and 1..50 operations.");
	const seen = new Set();
	const operations = input.operations.map((op) => {
		const target = instancePath(op.path);
		if (seen.has(target)) throw Error("Use one operation per target path.");
		seen.add(target);
		if (!["create", "set", "script"].includes(op.op))
			throw Error("Supported operations: create, set, script.");
		if (op.op === "create" && !CLASSES.has(op.className))
			throw Error(`Unsupported creation class: ${op.className}`);
		const properties = op.properties || {};
		if (!properties || typeof properties !== "object" || Array.isArray(properties))
			throw Error("properties must be an object.");
		for (const [key, val] of Object.entries(properties)) {
			if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || ["Source", "Parent", "Name", "ClassName"].includes(key))
				throw Error(`Protected property: ${key}`);
			valueCheck(val);
		}
		let source = op.source;
		if (op.sourceFile !== undefined) {
			if (source !== undefined || typeof op.sourceFile !== "string")
				throw Error("Specify source or sourceFile, not both.");
			source = readText(path.resolve(base, op.sourceFile));
		}
		if (
			op.op === "script" ||
			(op.op === "create" && ["Script", "LocalScript", "ModuleScript"].includes(op.className))
		) {
			if (typeof source !== "string" || Buffer.byteLength(source) > 256 * 1024)
				throw Error("Script operations require source/sourceFile of at most 256 KiB.");
			// Studio stores LF source. Freeze that representation in the review so
			// verification and rollback compare the bytes Studio will actually write.
			source = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		} else if (source !== undefined) throw Error("Source is allowed only for scripts.");
		if (op.op === "set" && Object.keys(properties).length === 0) throw Error("set requires properties.");
		return {
			op: op.op,
			path: target,
			...(op.className ? { className: op.className } : {}),
			properties,
			...(source !== undefined ? { source } : {}),
		};
	});
	const plan = { version: 1, name: input.name, operations };
	if (Buffer.byteLength(JSON.stringify(plan)) > 512 * 1024)
		throw Error("Plan exceeds 512 KiB. Split it into smaller changes.");
	return plan;
}
function luaString(value) {
	let equals = "";
	// A trailing ']' can overlap the closer even when no closer exists inside
	// the value (for example JSON arrays). Require its first match at the boundary.
	while ((value + "]" + equals + "]").indexOf("]" + equals + "]") !== value.length) equals += "=";
	// Initial newline is stripped by Lua long strings; JSON never starts with one.
	return "[" + equals + "[" + value + "]" + equals + "]";
}
function compile(payload) {
	return (
		'local request = game:GetService("HttpService"):JSONDecode(' +
		luaString(JSON.stringify(payload)) +
		")\n" +
		fs.readFileSync(path.join(__dirname, "studio-author.luau"), "utf8")
	);
}
async function execute(client, studio, payload) {
	return decodeResult(
		await client.call("execute_luau", {
			studio_id: studio.id,
			datamodel_type: "Edit",
			code: compile(payload),
		}),
	);
}
async function run(client, studio, command, document, options = {}) {
	if (command === "inspect") {
		const plan = validatePlan(document, options.base);
		const result = await execute(client, studio, { action: "inspect", plan });
		const review = {
			version: 1,
			placeId: result.placeId,
			studioId: studio.id,
			inspectedAt: new Date().toISOString(),
			plan,
			before: result.before,
		};
		return { ...review, digest: hash(review) };
	}
	if (command !== "apply") throw Error("Expected inspect or apply.");
	const { digest, ...review } = document;
	if (hash(review) !== digest) throw Error("Review changed; inspect the plan again.");
	if (review.studioId !== studio.id) throw Error("Studio session changed; inspect the plan again.");
	const validated = validatePlan(review.plan);
	if (validated.operations.some((op, i) => op.source !== review.plan.operations[i].source))
		throw Error("Review contains noncanonical source line endings; inspect the plan again.");
	if (!Array.isArray(review.before) || review.before.length !== review.plan.operations.length)
		throw Error("Invalid review snapshots.");
	// Save exact sources and prior values BEFORE sending any mutation.
	const journalDir = options.journalDir || path.join(ROOT, "build", "authoring");
	fs.mkdirSync(journalDir, { recursive: true });
	const journalPath = path.join(journalDir, `${Date.now()}-${crypto.randomUUID()}.json`);
	const journal = { status: "pending", review: document };
	fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), { flag: "wx" });
	try {
		const result = await execute(client, studio, {
			action: "apply",
			plan: review.plan,
			before: review.before,
			placeId: review.placeId,
		});
		journal.status = "applied";
		journal.result = result;
		fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
		return { ...result, journalPath, captureRequired: true };
	} catch (error) {
		journal.status = "unconfirmed";
		journal.error = error.message;
		fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
		throw Error(`${error.message} Journal: ${journalPath}. Inspect Studio before retrying.`, {
			cause: error,
		});
	}
}
const HELP = `First-party Studio authoring (no RoPilot calls)
  node scripts/studio-author.cjs preview plan.json
  node scripts/studio-author.cjs inspect plan.json --out build/authoring/review.json
  node scripts/studio-author.cjs apply build/authoring/review.json

preview is offline. inspect reads Studio and captures exact before-state.
apply requires that review and rejects changed targets. Edits use Studio Undo.
Options: --out <json>, --studio <id>, --full. Saved reviews print a compact
operation summary; --full also prints source and before-state. Follow AGENTS.md.
No save, publication, asset upload, or playtest is performed by this command.
`;
async function main(argv = process.argv.slice(2)) {
	const [command, file, ...rest] = argv;
	if (!command || ["help", "--help"].includes(command)) return process.stdout.write(HELP);
	if (!["preview", "inspect", "apply"].includes(command) || !file)
		throw Error("Use preview|inspect|apply <file>.");
	const opts = {};
	for (let i = 0; i < rest.length; i += 2) {
		if (rest[i] === "--full") {
			opts.full = true;
			i--;
			continue;
		}
		if (!["--out", "--studio"].includes(rest[i]) || !rest[i + 1]) throw Error("Unknown or missing option.");
		opts[rest[i].slice(2)] = rest[i + 1];
	}
	if (command === "inspect" && !opts.out) throw Error("inspect requires --out <review.json>.");
	if (opts.out && path.resolve(opts.out) === path.resolve(file))
		throw Error("Output must not overwrite the input.");
	const document = readJson(file);
	const base = path.dirname(path.resolve(file));
	let output;
	if (command === "preview") {
		const plan = validatePlan(document, base);
		output = { offline: true, plan, digest: hash(plan) };
	} else {
		const settings = require("./studio-config.cjs").read();
		const client = new McpClient(findBridge());
		try {
			await client.connect();
			const studio = chooseStudio(
				await client.call("list_roblox_studios"),
				opts.studio,
				settings.expectedPlaceId,
			);
			output = await run(client, studio, command, document, { base });
		} finally {
			client.close();
		}
	}
	const json = JSON.stringify(output, null, 2) + "\n";
	if (opts.out) {
		fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
		fs.writeFileSync(opts.out, json);
	}
	process.stdout.write(
		opts.out && !opts.full
			? JSON.stringify(
					command === "apply"
						? { ...output, output: path.resolve(opts.out) }
						: {
								output: path.resolve(opts.out),
								digest: output.digest,
								operations: (output.plan?.operations || []).map(({ op, path, className }) => ({
									op,
									path,
									...(className ? { className } : {}),
								})),
								...(output.journalPath ? { journalPath: output.journalPath } : {}),
							},
					null,
					2,
				) + "\n"
			: json,
	);
}
if (require.main === module)
	main().catch((error) => {
		process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
		process.exitCode = 1;
	});
module.exports = { validatePlan, instancePath, luaString, compile, decodeResult, hash, run, main };
