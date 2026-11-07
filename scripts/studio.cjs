#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");

const HELP = `Roblox Studio CLI (JSON output, no screen control)

node scripts/studio.cjs doctor
node scripts/studio.cjs studios
node scripts/studio.cjs tools [exact-tool-name]
node scripts/studio.cjs skill <skill-name>
node scripts/studio.cjs status
node scripts/studio.cjs tree [path] [--depth 3] [--limit 200] [--class BaseScript] [--keywords word]
node scripts/studio.cjs inspect <instance-path>
node scripts/studio.cjs script <script-path> [--start 1 --end 100]
node scripts/studio.cjs logs
node scripts/studio.cjs exec --file <local.luau>

Options: --studio <id>, --context Edit|Server|Client (default Edit),
         --timeout <seconds> (default 30), --out <file.json>, --raw, --full
With --out, stdout is a short receipt; --full also prints the saved JSON.

exec executes arbitrary Luau and CAN CHANGE the place. It does not save/import
those changes. Follow AGENTS.md after any Studio edits. Other commands only query.
The CLI never starts/stops a playtest or switches places automatically.
`;

function parse(argv) {
	const positional = [];
	const options = {};
	const values = new Set([
		"studio",
		"context",
		"timeout",
		"out",
		"depth",
		"limit",
		"class",
		"keywords",
		"start",
		"end",
		"file",
	]);
	for (let i = 0; i < argv.length; i++) {
		const item = argv[i];
		if (!item.startsWith("--")) {
			positional.push(item);
			continue;
		}
		const name = item.slice(2);
		if (["help", "raw", "full"].includes(name)) {
			options[name] = true;
			continue;
		}
		if (!values.has(name)) throw new Error(`Unknown option: ${item}`);
		if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${item}`);
		options[name] = argv[++i];
	}
	return { command: positional[0] || "help", target: positional[1], options };
}

function numberOption(options, name, fallback, max) {
	if (options[name] === undefined) return fallback;
	const value = Number(options[name]);
	if (!Number.isInteger(value) || value < 1 || value > max)
		throw new Error(`--${name} must be an integer from 1 to ${max}.`);
	return value;
}

function chooseStudio(result, explicitId, expectedPlaceId) {
	const studios = result.studios;
	if (!Array.isArray(studios))
		throw new Error("Unexpected Studio discovery response. Run studios to inspect it.");
	if (
		expectedPlaceId !== undefined &&
		expectedPlaceId !== null &&
		!/^(0|[1-9]\d*)$/.test(String(expectedPlaceId))
	)
		throw Error("Configured expectedPlaceId must be a numeric place ID.");
	if (explicitId) {
		const studio = studios.find((item) => item.id === explicitId);
		if (!studio) throw new Error("Requested Studio ID is not connected. Run studios for current IDs.");
		return studio;
	}
	if (expectedPlaceId === undefined || expectedPlaceId === null)
		throw Error(
			"Cannot uniquely identify the project Studio. Configure expectedPlaceId or explicitly select --studio for read-only inspection.",
		);
	const matching = expectedPlaceId
		? studios.filter(
				(item) =>
					String(item.placeId) === String(expectedPlaceId) ||
					new RegExp(`placeId:\\s*${String(expectedPlaceId)}\\b`).test(item.name || ""),
			)
		: studios;
	if (matching.length !== 1)
		throw new Error(
			"Cannot uniquely identify the project Studio. Run studios and pass --studio <id> explicitly.",
		);
	return matching[0];
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
	const { command, target, options } = parse(argv);
	if (command === "help" || options.help) {
		process.stdout.write(HELP);
		return;
	}
	const commands = [
		"doctor",
		"studios",
		"tools",
		"skill",
		"status",
		"tree",
		"inspect",
		"script",
		"logs",
		"exec",
	];
	if (!commands.includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
	const context = options.context || "Edit";
	if (!["Edit", "Server", "Client"].includes(context))
		throw new Error("--context must be Edit, Server, or Client.");
	const timeout = numberOption(options, "timeout", 30, 300) * 1000;
	const depth = numberOption(options, "depth", 3, 10);
	const limit = numberOption(options, "limit", 200, 10000);
	if (["inspect", "script", "skill"].includes(command) && !target)
		throw new Error(`${command} requires a target.`);
	if ((options.start === undefined) !== (options.end === undefined))
		throw new Error("Use --start and --end together.");
	const start = numberOption(options, "start", undefined, 1000000);
	const end = numberOption(options, "end", undefined, 1000000);
	if (start && end < start) throw new Error("--end must be at least --start.");
	let code;
	if (command === "exec") {
		if (!options.file) throw new Error("exec requires --file <local.luau>.");
		code = require("./text-files.cjs").readText(path.resolve(options.file));
		if (!code.trim()) throw new Error("Luau file is empty.");
	}
	const settings = require("./studio-config.cjs").read();
	const bridge = dependencies.client ? "provided transport" : findBridge();
	const client = dependencies.client || new McpClient(bridge, ["--stdio"], timeout);
	const write = dependencies.write || ((value) => process.stdout.write(value));
	try {
		const server = await client.connect();
		let data;
		let studio;
		if (command === "tools") {
			const listed = [];
			let cursor;
			do {
				const page = await client.request("tools/list", cursor ? { cursor } : {});
				listed.push(...page.tools);
				cursor = page.nextCursor;
			} while (cursor);
			data = target ? listed.filter((tool) => tool.name === target) : listed;
			if (target && data.length === 0) throw Error(`Tool not found: ${target}`);
		} else {
			const discovery = await client.call("list_roblox_studios");
			if (command === "studios") data = discovery;
			else {
				studio = chooseStudio(discovery, options.studio, settings.expectedPlaceId);
				const id = { studio_id: studio.id };
				if (command === "doctor")
					data = {
						bridge,
						node: process.version,
						server: server.serverInfo,
						studio,
						state: await client.call("get_studio_state", id),
					};
				if (command === "status") data = await client.call("get_studio_state", id);
				if (command === "tree")
					data = await client.call("search_game_tree", {
						...id,
						datamodel_type: context,
						max_depth: depth,
						head_limit: limit,
						...(target ? { path: target } : {}),
						...(options.class ? { instance_type: options.class } : {}),
						...(options.keywords ? { keywords: options.keywords } : {}),
					});
				if (command === "inspect") data = await client.call("inspect_instance", { ...id, path: target });
				if (command === "script")
					data = await client.call("script_read", {
						...id,
						target_file: target,
						...(start
							? {
									should_read_entire_file: false,
									start_line_one_indexed: start,
									end_line_one_indexed_inclusive: end,
								}
							: {}),
					});
				if (command === "logs") data = await client.call("get_console_output", id);
				if (command === "skill") data = await client.call("skill", { ...id, skill_name: target });
				if (command === "exec")
					data = await client.call("execute_luau", { ...id, datamodel_type: context, code });
			}
		}
		const output = options.raw ? data : { command, ...(studio ? { studio } : {}), data };
		const json = JSON.stringify(output, null, 2) + "\n";
		if (options.out) {
			const outputPath = path.resolve(options.out);
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, json);
		}
		write(
			options.out && !options.full
				? JSON.stringify({
						command,
						output: path.resolve(options.out),
						bytes: Buffer.byteLength(json),
						...(studio ? { studio } : {}),
					}) + "\n"
				: json,
		);
	} finally {
		client.close();
	}
}

if (require.main === module)
	main().catch((error) => {
		process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
		process.exitCode = 1;
	});

module.exports = { parse, chooseStudio, main };
