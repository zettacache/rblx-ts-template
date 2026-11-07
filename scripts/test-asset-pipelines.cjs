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
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { validate, xml, identity } = require("./studio-animation.cjs");
const blender = require("./blender.cjs");
const assets = require("./studio-assets.cjs");
function temp(t) {
	const p = fs.mkdtempSync(path.join(os.tmpdir(), "roblox-assets-"));
	t.after(() => fs.rmSync(p, { recursive: true, force: true }));
	return p;
}
function clip() {
	return {
		version: 1,
		name: "Idle <&> café",
		priority: "Idle",
		loop: true,
		channels: [
			{ name: "Body", parent: "Root" },
			{ name: "Root", parent: null },
		],
		keyframes: [0, 1].map((time) => ({
			time,
			poses: { Root: [...identity], Body: [...identity] },
			markers: time ? [{ name: "Done", value: "a<&b" }] : [],
		})),
	};
}
function staged(t) {
	const dir = temp(t),
		model = Buffer.alloc(12);
	model.write("glTF");
	model.writeUInt32LE(2, 4);
	model.writeUInt32LE(12, 8);
	fs.writeFileSync(path.join(dir, "model.glb"), model);
	const result = assets.prepare(
		{
			version: 1,
			assetType: "Model",
			file: "model.glb",
			displayName: "Fixture",
			description: "",
			creator: { groupId: "123" },
		},
		dir,
		path.join(dir, "stages"),
	);
	return { dir, ...result, receipt: path.join(dir, "receipt.json") };
}
const response = (value) => ({ ok: true, json: async () => value });
test("animation compiler orders parents and preserves escaped names/markers", () => {
	const result = validate(clip());
	assert.equal(result.channels[0].name, "Root");
	const text = xml(result);
	assert.match(text, /Idle &lt;&amp;&gt; café/);
	assert.match(text, /KeyframeMarker/);
	assert.match(text, /a&lt;&amp;b/);
});
test("animation rejects cycles, absent channels, duplicate times, and unsupported root motion", () => {
	let c = clip();
	c.channels[1].parent = "Body";
	assert.throws(() => validate(c), /cycle/);
	c = clip();
	delete c.keyframes[0].poses.Body;
	assert.throws(() => validate(c), /every channel/);
	c = clip();
	c.keyframes[1].time = 0;
	assert.throws(() => validate(c), /strictly/);
	c = clip();
	c.keyframes[1].poses.Root[0] = 1;
	assert.throws(() => validate(c), /Root container/);
});
test("animation rejects scaling, reflection and nonfinite transforms", () => {
	for (const value of [2, -1, NaN]) {
		const c = clip();
		c.keyframes[1].poses.Body[3] = value;
		assert.throws(() => validate(c), /scale|reflected|finite/);
	}
});
test("Blender job validation bounds render/frame sizes and resolves source files", (t) => {
	const dir = temp(t);
	fs.writeFileSync(path.join(dir, "source.py"), "pass");
	const job = { version: 1, name: "Fixture", script: "source.py" };
	assert.equal(blender.validate(job, dir).script, path.join(dir, "source.py"));
	assert.throws(() => blender.validate({ ...job, size: 4096 }, dir), /size/);
	assert.throws(
		() =>
			blender.validate(
				{ ...job, animation: { armature: "A", rootPart: "Root", start: 1, end: 1000, fps: 1 } },
				dir,
			),
		/60 seconds/,
	);
});
test("headless process errors and timeouts fail with a diagnostic log", async (t) => {
	const dir = temp(t);
	await assert.rejects(
		blender.launch(
			process.execPath,
			["-e", 'console.error("fixture failure"); process.exit(2)'],
			path.join(dir, "failure.log"),
		),
		/exited 2/,
	);
	assert.match(fs.readFileSync(path.join(dir, "failure.log"), "utf8"), /fixture failure/);
	await assert.rejects(
		blender.launch(process.execPath, ["-e", "setInterval(()=>{},1000)"], path.join(dir, "timeout.log"), 100),
		/timed out/,
	);
});

function blenderFixture(t) {
	const dir = temp(t),
		file = path.join(dir, "job.json");
	fs.writeFileSync(path.join(dir, "source.py"), "pass");
	fs.writeFileSync(path.join(dir, "dependency.txt"), "v1");
	fs.writeFileSync(
		file,
		JSON.stringify({
			version: 1,
			name: "CacheFixture",
			script: "source.py",
			views: ["front"],
			dependencies: ["dependency.txt"],
		}),
	);
	let calls = 0;
	const runtime = {
		root: path.join(dir, "outputs"),
		executable: "mock-blender",
		executableIdentity: () => ({ version: "test", sha256: "binary-v1" }),
		launch: async (_exe, args) => {
			calls++;
			const output = args.at(-1),
				job = JSON.parse(fs.readFileSync(args.at(-2)));
			for (const name of [
				"scene.blend",
				...job.formats.map((f) => "model." + f),
				...job.views.map((v) => v + ".png"),
				"Body.mesh.json",
			])
				fs.writeFileSync(path.join(output, name), "artifact " + name);
			fs.writeFileSync(
				path.join(output, "report.json"),
				JSON.stringify({ ok: true, size: job.size, samples: job.renderSamples }),
			);
		},
	};
	return {
		dir,
		file,
		runtime,
		get calls() {
			return calls;
		},
	};
}
test("Blender reuse verifies and copies every artifact, including recipe mesh outputs", async (t) => {
	const f = blenderFixture(t),
		first = await blender.run(f.file, {}, f.runtime);
	const hit = await blender.run(f.file, { reuse: true }, f.runtime);
	assert.equal(f.calls, 1);
	assert.equal(hit.cache.reused, true);
	assert.notEqual(first.output, hit.output);
	assert.ok(hit.cache.artifacts["Body.mesh.json"]);
	assert.deepEqual(
		Object.keys(hit.artifacts),
		["scene.blend", "model.glb", "model.fbx", "front.png"],
		"preserve the promoted-artifact contract",
	);
	assert.equal(
		JSON.parse(fs.readFileSync(path.join(hit.output, "job.json"))).script,
		path.join(hit.output, "source.py"),
	);
	fs.writeFileSync(path.join(hit.output, "Body.mesh.json"), "edited copy");
	assert.equal(fs.readFileSync(path.join(first.output, "Body.mesh.json"), "utf8"), "artifact Body.mesh.json");
	fs.writeFileSync(path.join(first.output, "Body.mesh.json"), "corrupted source");
	assert.equal((await blender.run(f.file, { reuse: true }, f.runtime)).cache.reused, false);
	assert.equal(f.calls, 2);
	await blender.run(f.file, {}, f.runtime);
	assert.equal(f.calls, 3, "reuse must be opt-in");
});
test("Blender cache invalidates for source, dependency, executable and preview profile", async (t) => {
	const f = blenderFixture(t);
	await blender.run(f.file, { reuse: true }, f.runtime);
	fs.writeFileSync(path.join(f.dir, "source.py"), "changed source");
	await blender.run(f.file, { reuse: true }, f.runtime);
	fs.writeFileSync(path.join(f.dir, "dependency.txt"), "v2");
	await blender.run(f.file, { reuse: true }, f.runtime);
	f.runtime.executableIdentity = () => ({ version: "test", sha256: "binary-v2" });
	await blender.run(f.file, { reuse: true }, f.runtime);
	const preview = await blender.run(f.file, { reuse: true, profile: "preview" }, f.runtime);
	assert.equal(f.calls, 5);
	assert.equal(preview.reviewProfile, "preview");
	assert.equal(preview.report.size, 256);
	assert.equal(preview.report.samples, 8);
	await blender.run(f.file, { reuse: true, profile: "preview" }, f.runtime);
	assert.equal(f.calls, 5);
	assert.throws(() => blender.profile({}, "typo"), /Profile/);
});
test("Blender failed runs and dependencies changing mid-run never publish reusable success", async (t) => {
	const f = blenderFixture(t),
		launch = f.runtime.launch;
	f.runtime.launch = async (...args) => {
		await launch(...args);
		fs.writeFileSync(path.join(f.dir, "dependency.txt"), "changed");
	};
	await assert.rejects(blender.run(f.file, { reuse: true }, f.runtime), /Dependency changed/);
	assert.equal(fs.existsSync(path.join(f.runtime.root, ".cache")), false);
	f.runtime.launch = async () => {
		throw Error("worker failed");
	};
	await assert.rejects(blender.run(f.file, { reuse: true }, f.runtime), /worker failed/);
	assert.equal(fs.existsSync(path.join(f.runtime.root, ".cache")), false);
});
test("Blender rejects a missing artifact and a modified cache manifest", async (t) => {
	const f = blenderFixture(t),
		first = await blender.run(f.file, {}, f.runtime);
	fs.unlinkSync(path.join(first.output, "front.png"));
	const next = await blender.run(f.file, { reuse: true }, f.runtime);
	assert.equal(f.calls, 2);
	fs.writeFileSync(path.join(next.output, "manifest.json"), "{}");
	await blender.run(f.file, { reuse: true }, f.runtime);
	assert.equal(f.calls, 3);
});
test("upload freezes bytes and detects changes to reviewed artifacts", (t) => {
	const { dir, review } = staged(t);
	fs.writeFileSync(path.join(dir, "model.glb"), "changed source");
	assert.equal(assets.verify(review).length, 12);
	fs.writeFileSync(review.file, "changed frozen artifact");
	assert.throws(() => assets.verify(review), /changed/);
});
test("upload requires one valid creator and verified native animations", (t) => {
	const dir = temp(t),
		file = path.join(dir, "clip.rbxm");
	fs.writeFileSync(file, "<roblox!fixture");
	const spec = {
		version: 1,
		assetType: "Animation",
		file,
		displayName: "Fixture",
		description: "",
		creator: { userId: "123" },
	};
	assert.throws(
		() => assets.prepare({ ...spec, creator: { userId: "123", groupId: "456" } }, dir),
		/one creator/,
	);
	assert.throws(() => assets.prepare(spec, dir), /ENOENT/);
	fs.writeFileSync(
		file + ".manifest.json",
		JSON.stringify({
			native: true,
			verified: true,
			artifactSha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
		}),
	);
	assert.equal(assets.prepare(spec, dir, path.join(dir, "stages")).review.mime, "model/x-rbxm");
});
test("upload posts once, polls, records asset identity without credentials", async (t) => {
	const s = staged(t),
		calls = [];
	const fetcher = async (url, opts) => {
		calls.push(opts.method);
		assert.equal(opts.headers["x-api-key"], "test-secret");
		assert.equal(opts.redirect, "error");
		if (opts.method === "POST") {
			assert.equal(JSON.parse(opts.body.get("request")).creationContext.expectedPrice, 0);
			return response({ path: "operations/test-id" });
		}
		return response({
			done: true,
			response: { assetId: "987", moderationResult: { moderationState: "Approved" } },
		});
	};
	const result = await assets.upload(s.reviewFile, s.receipt, "test-secret", fetcher);
	assert.equal(result.assetId, "987");
	assert.deepEqual(calls, ["POST", "GET"]);
	assert.ok(!fs.readFileSync(s.receipt, "utf8").includes("test-secret"));
	await assert.rejects(
		assets.upload(s.reviewFile, path.join(s.dir, "another.json"), "test-secret", fetcher),
		/EEXIST/,
	);
	assert.deepEqual(calls, ["POST", "GET"]);
});
test("ambiguous upload failure is recorded without a second POST", async (t) => {
	const s = staged(t);
	let count = 0;
	await assert.rejects(
		assets.upload(s.reviewFile, s.receipt, "key", async () => {
			count++;
			throw Error("timeout");
		}),
		/not retried/,
	);
	assert.equal(count, 1);
	assert.equal(JSON.parse(fs.readFileSync(s.receipt)).status, "unconfirmed");
	await assert.rejects(
		assets.poll(s.receipt, "key", async () => {
			count++;
		}),
		/No operation ID/,
	);
	assert.equal(count, 1);
});
test("poll rejects operation URL injection before sending credentials", async (t) => {
	const dir = temp(t),
		file = path.join(dir, "receipt.json");
	fs.writeFileSync(file, JSON.stringify({ status: "processing", operation: "https://example.com/steal" }));
	await assert.rejects(
		assets.poll(file, "key", async () => {
			assert.fail("Network must not be called");
		}),
		/operation path/,
	);
});
test("poll persists processing and failed states; missing key never submits", async (t) => {
	const s = staged(t);
	await assert.rejects(
		assets.upload(s.reviewFile, s.receipt, "", async () => assert.fail()),
		/environment/,
	);
	assert.ok(!fs.existsSync(s.receipt));
	fs.writeFileSync(s.receipt, JSON.stringify({ operation: "operations/test", status: "processing" }));
	assert.equal(
		(await assets.poll(s.receipt, "key", async () => response({ done: false }))).status,
		"processing",
	);
	assert.equal(
		(await assets.poll(s.receipt, "key", async () => response({ done: true, error: { code: 7 } }))).status,
		"failed",
	);
});
