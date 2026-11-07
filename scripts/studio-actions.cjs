#!/usr/bin/env node
// Game-scoped input and native screenshots. No OS input or window focus API.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readJson } = require("./text-files.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { mode, verifyOwnership } = require("./studio-play.cjs");
const { validateClick, nativeClickArguments, click } = require("./studio-input.cjs");
const { schemas } = require("./studio-schemas.cjs");
const TOOLS = {
	keyboard: "user_keyboard_input",
	mouse: "user_mouse_input",
	navigate: "character_navigation",
	screenshot: "screen_capture",
};
function validate(schema, value, at = "arguments") {
	if (schema.enum && !schema.enum.includes(value)) throw Error(`Invalid enum at ${at}`);
	if (schema.type === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`Expected object at ${at}`);
		for (const field of schema.required || [])
			if (value[field] === undefined) throw Error(`Missing ${at}.${field}`);
		for (const [key, item] of Object.entries(value)) {
			if (!schema.properties?.[key]) throw Error(`Unknown field ${at}.${key}`);
			validate(schema.properties[key], item, `${at}.${key}`);
		}
	} else if (schema.type === "array") {
		if (!Array.isArray(value)) throw Error(`Expected array at ${at}`);
		if (schema.minItems !== undefined && value.length < schema.minItems)
			throw Error(`Too few entries at ${at}`);
		if (value.length > (schema.maxItems || 100)) throw Error(`Too many entries at ${at}`);
		for (const item of value) validate(schema.items, item, at + "[]");
	} else if (schema.type === "integer" || schema.type === "number") {
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			(schema.type === "integer" && !Number.isInteger(value))
		)
			throw Error(`Expected finite number at ${at}`);
		if (
			(schema.minimum !== undefined && value < schema.minimum) ||
			(schema.maximum !== undefined && value > schema.maximum)
		)
			throw Error(`Number outside bounds at ${at}`);
	} else if (schema.type && typeof value !== schema.type) throw Error(`Expected ${schema.type} at ${at}`);
}
function prepare(document, available, studioId) {
	if (
		document.version !== 1 ||
		!Array.isArray(document.steps) ||
		document.steps.length < 1 ||
		document.steps.length > 30
	)
		throw Error("Action file needs version:1 and 1..30 steps.");
	return document.steps.map((step) => {
		if (step.kind === "click") {
			if (Object.keys(step).some((key) => !["kind", "arguments"].includes(key)))
				throw Error("Unknown action field.");
			if (!available.has("user_mouse_input") || !available.has("execute_luau"))
				throw Error("Calibrated clicks require native mouse and Luau tools.");
			validate(available.get("user_mouse_input"), nativeClickArguments(studioId, { x: 0, y: 0 }));
			return { kind: "click", args: validateClick(step.arguments) };
		}
		const tool = TOOLS[step.kind];
		if (!tool || !available.has(tool)) throw Error(`Unsupported action: ${step.kind}`);
		if (Object.keys(step).some((key) => !["kind", "arguments"].includes(key)))
			throw Error("Unknown action field.");
		const args = { ...(step.arguments || {}), studio_id: studioId };
		if ("studio_id" in (step.arguments || {})) throw Error("Action files cannot select another Studio.");
		if (step.kind !== "screenshot") args.datamodel_type = "Client";
		else if (!args.capture_id) args.capture_id = "RobloxTools_" + crypto.randomUUID();
		validate(available.get(tool), args);
		for (const action of args.actions || []) {
			if (
				action.action === "wait" &&
				(!Number.isInteger(action.wait_time_ms) || action.wait_time_ms < 0 || action.wait_time_ms > 10000)
			)
				throw Error("wait requires 0..10000 milliseconds.");
			if (action.action === "textInput" && typeof action.text_inputs !== "string")
				throw Error("textInput requires text_inputs.");
			if (["keyDown", "keyUp", "keyPress"].includes(action.action) && !action.key_code)
				throw Error("Keyboard action requires key_code.");
			if (
				["mouseButtonDown", "mouseButtonUp", "mouseButtonClick"].includes(action.action) &&
				!action.mouse_button
			)
				throw Error("Mouse action requires mouse_button.");
		}
		return { kind: step.kind, tool, args };
	});
}
async function run(client, studio, document, options = {}) {
	if (options.imagePrefix && !/^[A-Za-z0-9_-]+$/.test(options.imagePrefix))
		throw Error("Invalid image filename prefix.");
	const steps = prepare(document, options.schemas || (await schemas(client)), studio.id);
	if (steps.some((step) => step.kind === "screenshot") && !options.outputDir)
		throw Error("Screenshots require an output directory before execution.");
	if (!options.session && steps.some((step) => step.kind !== "screenshot"))
		throw Error("Runtime input requires an owned --session record.");
	const result = [];
	const inputState = options.inputState || {};
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.kind === "screenshot" && !options.session) {
			if (mode(await client.call("get_studio_state", { studio_id: studio.id })) !== "Edit")
				throw Error("Editor screenshot requires Edit mode.");
		} else {
			if (!options.session) throw Error("Runtime input requires an owned --session record.");
			await verifyOwnership(client, studio, options.session);
		}
		if (step.kind === "click") {
			result.push({
				kind: "click",
				context: "Client",
				images: [],
				response: await click(client, studio, step.args, options.session, inputState),
			});
			continue;
		}
		const raw = await client.callRaw(step.tool, step.args);
		if (raw.structuredContent?.success === false || raw.structuredContent?.error)
			throw Error(JSON.stringify(raw.structuredContent));
		for (const block of raw.content || []) {
			if (
				block.type === "text" &&
				/^(error\b|failed\b|unable\b|exception\b|an error occurred)/i.test(block.text.trim())
			)
				throw Error(block.text);
		}
		const images = [];
		for (const [j, block] of (raw.content || []).entries()) {
			if (block.type === "image") {
				if (!options.outputDir) throw Error("Image output requires an output directory.");
				const data = Buffer.from(block.data, "base64");
				const extension =
					block.mimeType === "image/png" ? "png" : block.mimeType === "image/jpeg" ? "jpg" : undefined;
				if (!extension) throw Error(`Unsupported screenshot image type: ${block.mimeType}`);
				const file = path.join(
					options.outputDir,
					`${options.imagePrefix || "step"}-${i + 1}-${j}.${extension}`,
				);
				fs.mkdirSync(options.outputDir, { recursive: true });
				fs.writeFileSync(file, data);
				images.push(file);
			}
		}
		if (step.kind === "screenshot" && images.length === 0)
			throw Error("Native screenshot returned no image; inspect the tool response.");
		result.push({
			kind: step.kind,
			context: options.session ? "Client" : "Edit",
			images,
			response: { ...raw, content: (raw.content || []).filter((block) => block.type !== "image") },
		});
	}
	return { studio, results: result };
}
async function main(argv = process.argv.slice(2)) {
	if (argv.length === 0 || argv.includes("--help"))
		return process.stdout.write(
			"Game-scoped input / screenshots through Roblox MCP\nnode scripts/studio-actions.cjs plan.json --out build/actions/check.json [--session build/playtests/session.json]\nNo desktop automation. Input and runtime screenshots require a matching owned session. Without --session, screenshots require Edit mode.\n",
		);
	const [file, ...rest] = argv;
	const options = {};
	for (let i = 0; i < rest.length; i += 2) {
		if (!["--out", "--session"].includes(rest[i]) || !rest[i + 1])
			throw Error("Use --out <report.json> and optional --session <owned-session.json>.");
		options[rest[i].slice(2)] = path.resolve(rest[i + 1]);
	}
	if (!options.out || options.out === path.resolve(file))
		throw Error("A distinct --out report path is required.");
	const client = new McpClient(findBridge(), ["--stdio"], 60000);
	try {
		await client.connect();
		const settings = require("./studio-config.cjs").read();
		const studio = chooseStudio(
			await client.call("list_roblox_studios"),
			undefined,
			settings.expectedPlaceId,
		);
		const report = await run(client, studio, readJson(file), {
			session: options.session,
			outputDir: path.join(path.dirname(options.out), path.basename(options.out, ".json") + "-images"),
		});
		fs.mkdirSync(path.dirname(options.out), { recursive: true });
		fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
		process.stdout.write(JSON.stringify(report, null, 2) + "\n");
	} finally {
		client.close();
	}
}
if (require.main === module)
	main().catch((error) => {
		console.error(JSON.stringify({ error: error.message }));
		process.exitCode = 1;
	});
module.exports = { validate, prepare, run, main };
