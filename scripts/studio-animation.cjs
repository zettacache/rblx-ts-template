#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { luaString, decodeResult, instancePath } = require("./studio-author.cjs");
const PRIORITY = { Idle: 0, Movement: 1, Action: 2, Action2: 3, Action3: 4, Action4: 5, Core: 1000 };
const identity = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const sha = (data) => createHash("sha256").update(data).digest("hex");
function name(value) {
	return (
		// eslint-disable-next-line no-control-regex -- Explicitly reject nonportable control characters.
		typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\x00-\x1f\x7f/]/.test(value)
	);
}
function transform(c) {
	if (!Array.isArray(c) || c.length !== 12 || !c.every((v) => typeof v === "number" && Number.isFinite(v)))
		throw Error("Pose needs 12 finite CFrame components.");
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++) {
			let dot = 0;
			for (let k = 0; k < 3; k++) dot += c[3 + i * 3 + k] * c[3 + j * 3 + k];
			if (Math.abs(dot - (i === j ? 1 : 0)) > 0.001) throw Error("Pose rotation contains scale or shear.");
		}
	const det =
		c[3] * (c[7] * c[11] - c[8] * c[10]) -
		c[4] * (c[6] * c[11] - c[8] * c[9]) +
		c[5] * (c[6] * c[10] - c[7] * c[9]);
	if (Math.abs(det - 1) > 0.001) throw Error("Pose rotation is reflected.");
}
function validate(doc) {
	if (
		doc.version !== 1 ||
		!name(doc.name) ||
		typeof doc.loop !== "boolean" ||
		!Object.hasOwn(PRIORITY, doc.priority)
	)
		throw Error("Clip requires version:1, name, loop boolean, and valid priority.");
	if (!Array.isArray(doc.channels) || !doc.channels.length || doc.channels.length > 100)
		throw Error("Clip needs 1..100 channels.");
	const channels = [],
		pending = new Map();
	for (const c of doc.channels) {
		if (!name(c.name) || (c.parent !== null && !name(c.parent)) || pending.has(c.name))
			throw Error("Channel names must be unique; parent is a name or null.");
		pending.set(c.name, { name: c.name, parent: c.parent });
	}
	for (const c of pending.values())
		if (c.parent !== null && !pending.has(c.parent)) throw Error("Missing channel parent.");
	const seen = new Set();
	while (pending.size) {
		let changed = false;
		for (const [key, c] of pending)
			if (c.parent === null || seen.has(c.parent)) {
				channels.push(c);
				seen.add(key);
				pending.delete(key);
				changed = true;
			}
		if (!changed) throw Error("Channel hierarchy contains a cycle.");
	}
	if (!Array.isArray(doc.keyframes) || doc.keyframes.length < 2 || doc.keyframes.length > 1801)
		throw Error("Clip needs 2..1801 keyframes.");
	let previous = -1;
	const keyframes = doc.keyframes.map((frame, index) => {
		if (
			!Number.isFinite(frame.time) ||
			frame.time < 0 ||
			frame.time > 60 ||
			frame.time <= previous ||
			(index === 0 && frame.time !== 0)
		)
			throw Error("Times must start at zero, strictly increase, and end within 60 seconds.");
		previous = frame.time;
		if (!frame.poses || Object.keys(frame.poses).length !== channels.length)
			throw Error("Every frame must provide every channel.");
		const poses = Object.create(null);
		for (const c of channels) {
			transform(frame.poses[c.name]);
			poses[c.name] = [...frame.poses[c.name]];
			if (c.parent === null && poses[c.name].some((v, i) => Math.abs(v - identity[i]) > 0.0001))
				throw Error("Root container poses must be identity; put animated root motion on a child joint/bone.");
		}
		const markers = frame.markers ?? [];
		if (
			!Array.isArray(markers) ||
			markers.length > 32 ||
			markers.some(
				(m) =>
					!name(m.name) ||
					typeof m.value !== "string" ||
					m.value.length > 512 ||
					// eslint-disable-next-line no-control-regex -- XML cannot represent these control characters.
					/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(m.value),
			)
		)
			throw Error("Invalid frame markers.");
		return { time: frame.time, poses, markers: markers.map((m) => ({ name: m.name, value: m.value })) };
	});
	const normalized = {
		version: 1,
		name: doc.name,
		loop: doc.loop,
		priority: doc.priority,
		channels,
		keyframes,
	};
	if (Buffer.byteLength(JSON.stringify(normalized)) > 500000)
		throw Error("Clip exceeds the 500 KB bridge limit; reduce sampling or split clips.");
	return normalized;
}
const xmlEscape = (value) =>
	String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function xml(doc) {
	doc = validate(doc);
	let id = 0;
	const item = (cls, props, children = "") =>
		`<Item class="${cls}" referent="RBX${++id}"><Properties>${props}</Properties>${children}</Item>`;
	const str = (key, value) => `<string name="${key}">${xmlEscape(value)}</string>`;
	const cframe = (value) =>
		'<CoordinateFrame name="CFrame">' +
		["X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"]
			.map((key, i) => `<${key}>${value[i]}</${key}>`)
			.join("") +
		"</CoordinateFrame>";
	function poses(parent, frame) {
		return doc.channels
			.filter((c) => c.parent === parent)
			.map((c) =>
				item(
					"Pose",
					str("Name", c.name) +
						cframe(frame.poses[c.name]) +
						'<float name="Weight">1</float><token name="EasingStyle">0</token><token name="EasingDirection">0</token>',
					poses(c.name, frame),
				),
			)
			.join("");
	}
	const frames = doc.keyframes
		.map((frame) =>
			item(
				"Keyframe",
				str("Name", "Keyframe") + `<float name="Time">${frame.time}</float>`,
				poses(null, frame) +
					frame.markers
						.map((m) => item("KeyframeMarker", str("Name", m.name) + str("Value", m.value)))
						.join(""),
			),
		)
		.join("");
	return (
		'<?xml version="1.0" encoding="utf-8"?>\n<roblox version="4">' +
		item(
			"KeyframeSequence",
			str("Name", doc.name) +
				`<bool name="Loop">${doc.loop}</bool><token name="Priority">${PRIORITY[doc.priority]}</token>`,
			frames,
		) +
		"</roblox>\n"
	);
}
async function native(client, studio, action, clip, rig, rigKind = "motor") {
	if (!["motor", "bone"].includes(rigKind)) throw Error("rig-kind must be motor or bone.");
	const payload = {
		action,
		clip: clip ? validate(clip) : undefined,
		rig: rig ? instancePath(rig) : undefined,
		rigKind,
		placeId: require("./studio-config.cjs").read().expectedPlaceId,
	};
	const code =
		'local request=game:GetService("HttpService"):JSONDecode(' +
		luaString(JSON.stringify(payload)) +
		")\n" +
		fs.readFileSync(path.join(__dirname, "studio-animation.luau"), "utf8");
	return decodeResult(
		await client.call("execute_luau", { studio_id: studio.id, datamodel_type: "Edit", code }),
	);
}
async function main(argv = process.argv.slice(2)) {
	if (!argv.length || argv[0] === "--help")
		return console.log(
			"studio-animation.cjs validate|compile|export|preview <clip.json> [--out <new-file>] [--rig <Studio.Model>] [--rig-kind motor|bone]\nstudio-animation.cjs rig <Studio.Model> [--out <new-json>]\ncompile: offline rbxmx. export: native rbxm. preview: numerical pose verification on isolated cloned or synthetic rig, stepped then destroyed. No uploads.",
		);
	const [action, file, ...rest] = argv,
		opts = {};
	if (!["validate", "compile", "export", "preview", "rig"].includes(action) || !file)
		throw Error("Invalid animation command.");
	for (let i = 0; i < rest.length; i += 2) {
		if (!["--out", "--rig", "--rig-kind"].includes(rest[i]) || !rest[i + 1] || opts[rest[i].slice(2)])
			throw Error("Invalid animation option.");
		opts[rest[i].slice(2)] = rest[i + 1];
	}
	if (
		["compile", "export"].includes(action) &&
		(!opts.out || path.extname(opts.out).toLowerCase() !== (action === "compile" ? ".rbxmx" : ".rbxm"))
	)
		throw Error("compile/export requires --out with .rbxmx/.rbxm extension.");
	if (opts.out && (fs.existsSync(opts.out) || fs.existsSync(opts.out + ".manifest.json")))
		throw Error("Choose a new output path; existing artifacts are preserved.");
	const clip = action === "rig" ? undefined : validate(require("./text-files.cjs").readJson(file));
	let result, bytes;
	if (action === "validate")
		result = {
			valid: true,
			channels: clip.channels.length,
			frames: clip.keyframes.length,
			duration: clip.keyframes.at(-1).time,
		};
	else if (action === "compile") {
		bytes = Buffer.from(xml(clip));
		result = { native: false, format: "rbxmx" };
	} else {
		const client = new McpClient(findBridge(), ["--stdio"], 60000);
		try {
			await client.connect();
			const studio = chooseStudio(
				await client.call("list_roblox_studios"),
				undefined,
				require("./studio-config.cjs").read().expectedPlaceId,
			);
			result = await native(
				client,
				studio,
				action,
				clip,
				action === "rig" ? file : opts.rig,
				opts["rig-kind"],
			);
			if (action === "export") {
				bytes = Buffer.from(result.base64, "base64");
				delete result.base64;
				if (bytes.subarray(0, 8).toString() !== "<roblox!" || sha(bytes) !== result.sha256)
					throw Error("Native animation transfer checksum/header mismatch.");
			}
		} finally {
			client.close();
		}
	}
	if (bytes)
		result = {
			...result,
			artifactSha256: sha(bytes),
			bytes: bytes.length,
			clipSha256: sha(JSON.stringify(clip)),
		};
	if (opts.out) {
		fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
		fs.writeFileSync(opts.out, bytes || JSON.stringify(result, null, 2), { flag: "wx" });
		if (bytes) fs.writeFileSync(opts.out + ".manifest.json", JSON.stringify(result, null, 2), { flag: "wx" });
	}
	console.log(JSON.stringify(result, null, 2));
}
if (require.main === module)
	main().catch((e) => {
		console.error(JSON.stringify({ error: e.message }));
		process.exitCode = 1;
	});
module.exports = { validate, transform, xml, native, identity, main };
