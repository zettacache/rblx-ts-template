#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { luaString } = require("./studio-author.cjs");
const { decodeResult } = require("./studio-result.cjs");
const { mode } = require("./studio-state.cjs");
const ROOT = path.resolve(__dirname, "..");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const HELP = `Read complete Studio scripts through the existing MCP bridge.
node scripts/studio-sources.cjs <path> [<path> ...] [--source editor|stored] [--out <new-directory>]
node scripts/studio-sources.cjs --paths <paths.json> [--source editor|stored] [--out <new-directory>]
Paths are exact dot paths; JSON also accepts segment arrays for names containing dots.
Example JSON: [["ReplicatedStorage","Game","Config"]]
Default: editor buffers, project Studio in Edit mode, unique build/script-sources directory.
Maximum 16 scripts per invocation, 1 MiB each. No Studio writes or playtest controls.
Writes verified raw .luau files plus manifest.json; stdout is a compact receipt.
Missing/changed/unreadable scripts produce a partial manifest and nonzero exit.
`;
function parse(argv) {
	const options = { targets: [], source: "editor" };
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) {
			options.targets.push(argv[i]);
			continue;
		}
		const key = argv[i].slice(2);
		if (!["paths", "source", "out"].includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--"))
			throw Error("Invalid option; use --help.");
		options[key] = argv[++i];
	}
	if (!["editor", "stored"].includes(options.source)) throw Error("--source must be editor or stored.");
	if (options.paths) {
		if (options.targets.length) throw Error("Use positional paths or --paths, not both.");
		options.targets = JSON.parse(require("./text-files.cjs").readText(path.resolve(options.paths)));
	}
	options.targets = normalizePaths(options.targets);
	return options;
}
function normalizePaths(targets) {
	if (!Array.isArray(targets) || targets.length < 1 || targets.length > 16)
		throw Error("Supply 1..16 exact script paths.");
	const normalized = targets.map((target) => {
		const segments = typeof target === "string" ? target.replace(/^game\./, "").split(".") : target;
		if (
			!Array.isArray(segments) ||
			!segments.length ||
			segments.length > 64 ||
			segments.some((s) => typeof s !== "string" || !s.length || s.length > 256)
		)
			throw Error("Invalid script path.");
		return [...segments];
	});
	if (new Set(normalized.map((p) => JSON.stringify(p))).size !== normalized.length)
		throw Error("Duplicate script paths.");
	return normalized;
}
function compile(request) {
	return (
		'local request=game:GetService("HttpService"):JSONDecode(' +
		luaString(JSON.stringify(request)) +
		")\n" +
		fs.readFileSync(path.join(__dirname, "studio-sources.luau"), "utf8")
	);
}
async function fetchSources(client, studio, placeId, targets, sourceMode = "editor") {
	targets = normalizePaths(targets);
	if (!["editor", "stored"].includes(sourceMode)) throw Error("Invalid source mode.");
	const records = targets.map((segments) => ({ segments, offset: 0, chunks: [] }));
	let calls = 0;
	while (records.some((r) => !r.done)) {
		const pending = records.filter((r) => !r.done);
		const length = Math.floor(24000 / pending.length);
		const items = pending.map((r) => ({
			segments: r.segments,
			offset: r.offset,
			length,
			...(r.sha256 ? { sha256: r.sha256 } : {}),
		}));
		const response = decodeResult(
			await client.call("execute_luau", {
				studio_id: studio.id,
				datamodel_type: "Edit",
				code: compile({ placeId: String(placeId), sourceMode, items }),
			}),
		);
		calls++;
		if (
			response.placeId !== String(placeId) ||
			!Array.isArray(response.items) ||
			response.items.length !== pending.length
		)
			throw Error("Incomplete source response or wrong place.");
		for (let i = 0; i < pending.length; i++) {
			const record = pending[i],
				item = response.items[i];
			if (!item || JSON.stringify(item.segments) !== JSON.stringify(record.segments))
				throw Error("Source response path mismatch.");
			if (item.ok === false && typeof item.error === "string") {
				record.error = item.error;
				record.done = true;
				record.chunks = [];
				continue;
			}
			if (
				item.ok !== true ||
				item.sourceMode !== sourceMode ||
				!["Script", "LocalScript", "ModuleScript"].includes(item.className) ||
				typeof item.differsFromStored !== "boolean" ||
				!Number.isSafeInteger(item.bytes) ||
				item.bytes < 0 ||
				item.bytes > 1048576 ||
				!/^[a-f0-9]{64}$/.test(item.sha256) ||
				item.offset !== record.offset ||
				item.bytes < record.offset ||
				typeof item.data !== "string"
			)
				throw Error("Malformed source chunk.");
			if (
				record.sha256 &&
				(item.sha256 !== record.sha256 || item.bytes !== record.bytes || item.className !== record.className)
			)
				throw Error("Source changed during transfer.");
			const bytes = Buffer.from(item.data, "base64");
			if (
				bytes.toString("base64") !== item.data ||
				bytes.length !== Math.min(length, item.bytes - record.offset)
			)
				throw Error("Truncated or invalid source chunk.");
			Object.assign(record, {
				sha256: item.sha256,
				bytes: item.bytes,
				className: item.className,
				differsFromStored: Boolean(record.differsFromStored || item.differsFromStored),
			});
			record.chunks.push(bytes);
			record.offset += bytes.length;
			if (record.offset === record.bytes) {
				record.data = Buffer.concat(record.chunks);
				if (sha(record.data) !== record.sha256) throw Error("Source checksum mismatch.");
				record.done = true;
				record.chunks = [];
			}
		}
	}
	return { records, calls };
}
function writeBundle(directory, fetched, provenance) {
	// A new directory and numeric filenames prevent collisions and path traversal.
	fs.mkdirSync(path.dirname(directory), { recursive: true });
	fs.mkdirSync(directory);
	const scripts = fetched.records.map((record, index) => {
		const entry = { segments: record.segments, status: record.error ? "error" : "complete" };
		if (record.error) return { ...entry, error: record.error };
		const filename = String(index + 1).padStart(3, "0") + ".luau";
		fs.writeFileSync(path.join(directory, filename), record.data, { flag: "wx" });
		return {
			...entry,
			file: filename,
			className: record.className,
			bytes: record.bytes,
			lines: record.data.length ? record.data.toString("utf8").split("\n").length : 0,
			sha256: record.sha256,
			differsFromStored: record.differsFromStored,
		};
	});
	const complete = scripts.every((s) => s.status === "complete");
	const manifest = {
		version: 1,
		...provenance,
		context: "Edit",
		complete,
		sourceCalls: fetched.calls,
		consistency: "Each file is hash-verified; the collection is not an atomic place snapshot.",
		scripts,
	};
	fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
		flag: "wx",
	});
	return {
		complete,
		output: directory,
		manifest: path.join(directory, "manifest.json"),
		scripts: scripts.length,
		failed: scripts.filter((s) => s.status === "error").length,
		sourceCalls: fetched.calls,
	};
}
async function main(argv = process.argv.slice(2), dependencies = {}) {
	if (!argv.length || argv.includes("--help")) {
		(dependencies.write || console.log)(HELP);
		return;
	}
	const options = parse(argv);
	const directory = path.resolve(
		options.out || path.join(ROOT, "build", "script-sources", crypto.randomUUID()),
	);
	if (fs.existsSync(directory)) throw Error("Output directory already exists; choose a new directory.");
	const settings = require("./studio-config.cjs").read();
	const client = dependencies.client || new McpClient(findBridge(), ["--stdio"], 30000);
	let fetched, studio;
	const startedAt = new Date().toISOString();
	try {
		await client.connect();
		studio = chooseStudio(await client.call("list_roblox_studios"), undefined, settings.expectedPlaceId);
		if (mode(await client.call("get_studio_state", { studio_id: studio.id })) !== "Edit")
			throw Error("Source export requires Edit mode; leave the active test untouched.");
		fetched = await fetchSources(client, studio, settings.expectedPlaceId, options.targets, options.source);
	} finally {
		client.close();
	}
	const receipt = writeBundle(directory, fetched, {
		studioId: studio.id,
		placeId: String(settings.expectedPlaceId),
		sourceMode: options.source,
		startedAt,
		completedAt: new Date().toISOString(),
	});
	(dependencies.write || console.log)(JSON.stringify(receipt));
	return receipt;
}
if (require.main === module)
	main()
		.then((result) => {
			if (result && !result.complete) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(JSON.stringify({ error: error.message }));
			process.exitCode = 1;
		});
module.exports = { parse, normalizePaths, compile, fetchSources, writeBundle, main };
