#!/usr/bin/env node
// Named native captures over the existing lifecycle. No game-specific profile or UI hooks.
const fs = require("node:fs"),
	path = require("node:path"),
	crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { readJson, readText } = require("./text-files.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { lifecycle, verifyOwnership } = require("./studio-native-play.cjs");
const { run: actions } = require("./studio-actions.cjs");
const { decodeResult } = require("./studio-result.cjs");
const device = require("./studio-device.cjs");
const { mode } = require("./studio-state.cjs");
const ROOT = path.resolve(__dirname, "..");
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const canonical = (value) =>
	JSON.stringify(value, (_, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]]),
				)
			: v,
	);
function inside(root, file) {
	const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
	assert(
		relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative),
		"Review input escapes checkout",
	);
	return file;
}
async function viewState(probe) {
	return probe(
		"Client",
		`local c=workspace.CurrentCamera; local l=game.Lighting; local sky=l:FindFirstChildOfClass('Sky')
return {viewport={viewport=tostring(c.ViewportSize),orientation=game.StarterGui.ScreenOrientation.Name},
lighting={clock=l.ClockTime,ambient=tostring(l.Ambient),outdoor=tostring(l.OutdoorAmbient),brightness=l.Brightness,exposure=l.ExposureCompensation,sky=sky and {sky.SkyboxBk,sky.SkyboxDn,sky.SkyboxFt,sky.SkyboxLf,sky.SkyboxRt,sky.SkyboxUp} or {}},
cameraBeforeNativeCapture={position={c.CFrame.Position.X,c.CFrame.Position.Y,c.CFrame.Position.Z},look={c.CFrame.LookVector.X,c.CFrame.LookVector.Y,c.CFrame.LookVector.Z},type=c.CameraType.Name,fov=c.FieldOfView}}`,
	);
}
function validate(doc) {
	assert(
		doc.version === 1 &&
			typeof doc.name === "string" &&
			doc.name.trim() &&
			Array.isArray(doc.views) &&
			doc.views.length >= 1 &&
			doc.views.length <= 12,
		"Expected version 1, name, and 1..12 views",
	);
	const names = new Set();
	for (const v of doc.views) {
		assert(
			typeof v.name === "string" && /^[a-z0-9-]{1,64}$/.test(v.name) && !names.has(v.name),
			"Unique safe view names required",
		);
		names.add(v.name);
		assert(["ui", "world"].includes(v.kind), "View kind must be ui/world");
		assert(["desktop", "portrait", "landscape"].includes(v.device), "Unknown device");
		if (doc.devices?.[v.device]) device.validateDevice(doc.devices[v.device]);
		if (v.device !== "desktop")
			assert(doc.devices?.[v.device], "Declare an explicit mobile device preset in devices");
		if (v.kind === "ui")
			assert(
				typeof v.open === "string" && v.open && typeof v.close === "string" && v.close,
				"UI needs native open/close instance paths",
			);
		for (const key of ["position", "lookAt", "player"])
			if (v[key] !== undefined)
				assert(
					Array.isArray(v[key]) && v[key].length === 3 && v[key].every(Number.isFinite),
					"Camera/player coordinates must be finite triples",
				);
		if (v.kind === "world") assert(v.position && v.lookAt, "World view needs position/lookAt");
		if (v.fov !== undefined)
			assert(Number.isFinite(v.fov) && v.fov >= 1 && v.fov <= 120, "FOV must be 1..120");
	}
	return doc;
}
async function capture(file, out, runtime = {}) {
	const doc = validate(readJson(file)),
		base = path.dirname(file),
		root = runtime.root || ROOT;
	inside(root, file);
	const relative = path.relative(root, path.resolve(out));
	assert(
		relative && !relative.startsWith("..") && !path.isAbsolute(relative),
		"Review output must stay inside checkout",
	);
	let ancestor = path.dirname(out);
	while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
	if (path.resolve(ancestor) !== path.resolve(root)) inside(root, ancestor);
	assert(!fs.existsSync(out), "Use a fresh output directory; prior evidence is immutable");
	const probes = [
		doc.ready,
		doc.setupServer,
		...doc.views.flatMap((v) => [v.check, ...(v.interactions || []).map((i) => i.assert)]),
	].filter(Boolean);
	const frozen = new Map();
	const provenance = {};
	for (const f of new Set([...(doc.sources || []), ...(doc.references || []), ...probes])) {
		const full = inside(root, path.resolve(base, f));
		provenance[path.relative(root, full)] = hash(full);
		if (probes.includes(f)) frozen.set(f, readText(full));
	}
	fs.mkdirSync(out, { recursive: true });
	const report = {
		version: 1,
		name: doc.name,
		manifestSha256: hash(file),
		toolSha256: hash(__filename),
		provenance,
		startedAt: new Date().toISOString(),
		passed: false,
		visualAcceptance: "requires-image-review",
		views: [],
	};
	const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
	const client = runtime.client || new McpClient(findBridge(), ["--stdio"], 60000);
	const life = runtime.lifecycle || lifecycle,
		devices = runtime.devices || device,
		act = runtime.actions || actions;
	let studio, prior, session;
	const exec = async (context, code) =>
		decodeResult(await client.call("execute_luau", { studio_id: studio.id, datamodel_type: context, code }));
	const probe = async (context, code) => {
		await (runtime.verifyOwnership || verifyOwnership)(client, studio, session);
		return (
			await exec(
				context,
				`local function check()\n${code}\nend; local value=check(); return game.HttpService:JSONEncode({robloxStudio=1,ok=true,value=value})`,
			)
		).value;
	};
	const checked = async (context, f) => {
		if (f) {
			const value = await probe(context, frozen.get(f));
			assert(value?.passed === true, "Review probe failed: " + f);
			return value;
		}
	};
	try {
		await client.connect();
		studio = chooseStudio(
			await client.call("list_roblox_studios"),
			process.env.STUDIO_RESERVATION_STUDIO,
			require("./studio-config.cjs").read(root).expectedPlaceId,
		);
		(runtime.assertOwnership || require("./studio-guard.cjs").assert)(root, studio.id);
		assert.equal(
			mode(await client.call("get_studio_state", { studio_id: studio.id })),
			"Edit",
			"Another test is active",
		);
		prior = await devices.snapshot(client, studio);
		report.deviceBefore = prior;
		save();
		for (const v of doc.views) {
			const actualDevice = await devices.configure(
				client,
				studio,
				doc.devices?.[v.device] || { id: "default" },
			);
			session = path.join(out, v.name + ".session.json");
			// Register before starting; an ambiguous start leaves the original receipt for recovery.
			await life(client, studio, "start", session);
			await checked("Client", doc.ready);
			await checked("Server", doc.setupServer);
			const inputState = {},
				action = (step) =>
					act(
						client,
						studio,
						{ version: 1, steps: [step] },
						{ session, inputState, outputDir: out, imagePrefix: v.name },
					);
			const click = (instance_path) => action({ kind: "click", arguments: { instance_path } });
			if (v.player)
				await probe(
					"Server",
					`local p=game.Players:GetPlayers()[1];assert(p and p.Character);p.Character:PivotTo(CFrame.new(${v.player.join(",")}));return true`,
				);
			if (v.kind === "world")
				await probe(
					"Client",
					`local c=workspace.CurrentCamera;c.CameraType=Enum.CameraType.Scriptable;c.FieldOfView=${v.fov || 60};c.CFrame=CFrame.lookAt(Vector3.new(${v.position.join(",")}),Vector3.new(${v.lookAt.join(",")}));game.RunService.RenderStepped:Wait();return true`,
				);
			else await click(v.open);
			await checked("Client", v.check);
			const state = await viewState(probe);
			const shot = await action({
				kind: "screenshot",
				arguments: v.kind === "world" ? { camera_position: v.position, look_at_position: v.lookAt } : {},
			});
			const image = path.basename(shot.results[0].images[0]);
			report.views.push({
				name: v.name,
				kind: v.kind,
				device: actualDevice,
				...state,
				image,
				imageSha256: hash(path.join(out, image)),
			});
			save();
			for (const i of v.interactions || []) {
				await click(i.click);
				await checked("Client", i.assert);
			}
			if (v.kind === "ui") await click(v.close);
			await life(client, studio, "stop", session);
			session = undefined;
		}
		assert.equal(hash(file), report.manifestSha256, "Review manifest changed during capture");
		for (const [f, digest] of Object.entries(provenance))
			assert.equal(hash(path.join(root, f)), digest, "Review input changed: " + f);
		report.passed = true;
	} catch (error) {
		report.error = error.message;
	} finally {
		await require("./studio-guard.cjs").withCleanup(async () => {
			if (session)
				try {
					await life(client, studio, "stop", session);
					session = undefined;
				} catch (error) {
					report.cleanupError = error.message;
					report.passed = false;
				}
			if (prior && !session)
				try {
					assert.equal(
						mode(await client.call("get_studio_state", { studio_id: studio.id })),
						"Edit",
						"Device restoration requires Edit",
					);
					await devices.restore(client, studio, prior);
					report.deviceRestored = await devices.snapshot(client, studio);
					assert.deepEqual(report.deviceRestored, prior, "Original device settings were not restored");
				} catch (error) {
					report.restoreError = error.message;
					report.passed = false;
				}
		});
		report.finishedAt = new Date().toISOString();
		client.close();
		report.bridgeTimings = client.timingSummary?.();
		save();
	}
	if (!report.passed)
		throw Object.assign(Error("Visual review failed; inspect " + path.join(out, "report.json")), { report });
	return report;
}
const escape = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
function compare(beforeFile, afterFile, out, options = {}) {
	const before = readJson(beforeFile),
		after = readJson(afterFile);
	if (path.resolve(out) === path.resolve(beforeFile) || path.resolve(out) === path.resolve(afterFile))
		throw Error("Gallery must not overwrite reports");
	if (!before.passed || !after.passed) throw Error("Only successful capture runs can be compared");
	if (before.manifestSha256 !== after.manifestSha256)
		throw Error("Camera/device manifest changed; comparisons must use the same views");
	if (
		!before.views.length ||
		before.views.length !== after.views.length ||
		new Set(before.views.map((v) => v.name)).size !== before.views.length ||
		new Set(after.views.map((v) => v.name)).size !== after.views.length
	)
		throw Error("Review view sets differ or repeat");
	const rows = before.views.map((a) => {
		const b = after.views.find((x) => x.name === a.name);
		if (!b) throw Error("Missing view " + a.name);
		if (canonical(a.viewport) !== canonical(b.viewport) || canonical(a.device) !== canonical(b.device))
			throw Error("Viewport/device changed for " + a.name);
		if (
			a.lighting &&
			b.lighting &&
			canonical(a.lighting) !== canonical(b.lighting) &&
			!options.allowLightingChange
		)
			throw Error("Lighting changed for " + a.name);
		return { a, b };
	});
	fs.mkdirSync(path.dirname(out), { recursive: true });
	const img = (file, v) => {
		const f = inside(path.dirname(file), path.resolve(path.dirname(file), v.image));
		if (hash(f) !== v.imageSha256) throw Error("Capture bytes changed: " + f);
		return escape(path.relative(path.dirname(out), f).replaceAll("\\", "/"));
	};
	const html = `<!doctype html><meta charset="utf-8"><title>Studio visual review</title><style>body{font:16px system-ui;background:#12263a;color:#edf6ff;margin:32px}section{margin:36px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;object-fit:contain;max-height:720px;background:#08131e}h2{margin-bottom:8px}figcaption{margin:8px 0}figure{margin:0}p{max-width:80ch;line-height:1.5}code{color:#a6d8ff}</style><h1>${escape(after.name)}</h1><p>Actual Studio runtime captures. Identical named camera/device/UI-state manifest; full images are preserved. Human review is required: no aesthetic score is generated. Record the three visible issues, revisions and residual limitations in the handoff.</p>${rows.map(({ a, b }) => `<section><h2>${escape(a.name)}</h2><code>${escape(JSON.stringify(a.viewport))}</code><div class="pair"><figure><figcaption>Baseline</figcaption><a href="${img(beforeFile, a)}"><img src="${img(beforeFile, a)}"></a></figure><figure><figcaption>Revision</figcaption><a href="${img(afterFile, b)}"><img src="${img(afterFile, b)}"></a></figure></div></section>`).join("")}`;
	fs.writeFileSync(
		out,
		options.allowLightingChange
			? html.replace(
					"<h1>",
					"<p>Lighting study: lighting differences are intentional; camera, viewport and image integrity checks remain enforced. Recorded lighting values are retained in each report.</p><h1>",
				)
			: html,
	);
	return { gallery: out, views: rows.length };
}
async function main(argv = process.argv.slice(2)) {
	if (argv[0] === "capture" && argv.length === 4 && argv[2] === "--out") {
		const r = await capture(path.resolve(argv[1]), path.resolve(argv[3]));
		console.log(JSON.stringify({ passed: r.passed, views: r.views.length, cleanup: r.cleanup }));
	} else if (
		argv[0] === "compare" &&
		(argv.length === 5 || (argv.length === 6 && argv[5] === "--lighting-study")) &&
		argv[3] === "--out"
	)
		console.log(
			compare(path.resolve(argv[1]), path.resolve(argv[2]), path.resolve(argv[4]), {
				allowLightingChange: argv[5] === "--lighting-study",
			}),
		);
	else
		console.log(
			"studio-visual-review capture <manifest.json> --out <new-directory>\nstudio-visual-review compare <before/report.json> <after/report.json> --out <gallery.html> [--lighting-study]",
		);
}
if (require.main === module)
	main().catch((e) => {
		console.error(e.message);
		process.exitCode = 1;
	});
module.exports = { validate, compare, capture, viewState };
