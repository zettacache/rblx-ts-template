const test = require("node:test"),
	assert = require("node:assert/strict"),
	fs = require("node:fs"),
	path = require("node:path"),
	crypto = require("node:crypto");
const { validate, compare, viewState } = require("./studio-visual-review.cjs");
const { run: actions } = require("./studio-actions.cjs");
const temporary = path.resolve(__dirname, "../build/test-temp");
fs.mkdirSync(temporary, { recursive: true });

test("reject invalid/repeated camera views before connecting", () => {
	const v = {
		name: "gate",
		kind: "world",
		device: "desktop",
		position: [0, 9, 0],
		lookAt: [0, 2, 1],
		player: [0, 3, 0],
	};
	assert.equal(validate({ version: 1, name: "test", views: [v] }).views.length, 1);
	assert.throws(() => validate({ version: 1, name: "test", views: [v, v] }), /Unique/);
	assert.throws(
		() => validate({ version: 1, name: "test", views: [{ ...v, position: [NaN, 0, 0] }] }),
		/finite/,
	);
	assert.throws(() => validate({ version: 1, name: "test", views: [{ ...v, name: "../escape" }] }), /safe/);
	assert.throws(
		() => validate({ version: 1, name: "test", views: [{ name: "shop", kind: "ui", device: "desktop" }] }),
		/open\/close/,
	);
});
test("comparison preserves images and rejects mismatched views and altered evidence", () => {
	const dir = fs.mkdtempSync(path.join(temporary, "template-visual-"));
	try {
		fs.writeFileSync(path.join(dir, "shot.jpg"), "test-image-bytes");
		const digest = crypto.createHash("sha256").update("test-image-bytes").digest("hex");
		const make = (viewport = "750,381") => ({
			passed: true,
			name: "Review <test>",
			manifestSha256: "camera-manifest",
			views: [
				{
					name: "shop",
					viewport: { viewport },
					device: { id: "phone", orientation: "LandscapeLeft" },
					image: "shot.jpg",
					imageSha256: digest,
				},
			],
		});
		const a = path.join(dir, "before.json"),
			b = path.join(dir, "after.json"),
			out = path.join(dir, "review.html");
		const write = (r) => fs.writeFileSync(b, JSON.stringify(r));
		fs.writeFileSync(a, JSON.stringify(make()));
		write(make());
		assert.equal(compare(a, b, out).views, 1);
		assert.match(fs.readFileSync(out, "utf8"), /Review &lt;test&gt;/);
		write(make("different"));
		assert.throws(() => compare(a, b, out), /Viewport/);
		const changed = make();
		changed.manifestSha256 = "different-camera";
		write(changed);
		assert.throws(() => compare(a, b, out), /manifest changed/);
		const failed = make();
		failed.passed = false;
		write(failed);
		assert.throws(() => compare(a, b, out), /successful/);
		const litA = make(),
			litB = make();
		litA.views[0].lighting = { clock: 14 };
		litB.views[0].lighting = { clock: 18 };
		fs.writeFileSync(a, JSON.stringify(litA));
		write(litB);
		assert.throws(() => compare(a, b, out), /Lighting/);
		assert.equal(compare(a, b, out, { allowLightingChange: true }).views, 1);
		assert.match(fs.readFileSync(out, "utf8"), /Lighting study/);
		litB.views[0].viewport.viewport = "changed";
		write(litB);
		assert.throws(() => compare(a, b, out, { allowLightingChange: true }), /Viewport/);
		fs.writeFileSync(a, JSON.stringify(make()));
		write(make());
		fs.writeFileSync(path.join(dir, "shot.jpg"), "changed");
		assert.throws(() => compare(a, b, out), /bytes changed/);
	} finally {
		assert.equal(path.dirname(dir), path.resolve(temporary));
		assert.ok(path.basename(dir).startsWith("template-visual-"));
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("repeated visual actions reuse schemas while checking ownership for every capture", async () => {
	const dir = fs.mkdtempSync(path.join(temporary, "template-visual-cache-"));
	try {
		const session = path.join(dir, "session.json");
		fs.writeFileSync(session, JSON.stringify({ studioId: "fixture", status: "running", token: "owned" }));
		let discoveries = 0,
			states = 0,
			markers = 0,
			shots = 0,
			probes = 0;
		const client = {
			async request() {
				discoveries++;
				return {
					tools: [
						{
							name: "screen_capture",
							inputSchema: {
								type: "object",
								properties: { studio_id: { type: "string" }, capture_id: { type: "string" } },
							},
						},
					],
				};
			},
			async call(name) {
				if (name === "get_studio_state") {
					states++;
					return { text: "Current Studio Mode: Play" };
				}
				markers++;
				return { robloxStudio: 1, ok: true, token: "owned" };
			},
			async callRaw() {
				shots++;
				return {
					content: [
						{
							type: "image",
							mimeType: "image/png",
							data: Buffer.from("mock image, not live evidence").toString("base64"),
						},
					],
				};
			},
		};
		for (let i = 0; i < 12; i++) {
			const state = await viewState(async (context, code) => {
				probes++;
				assert.equal(context, "Client");
				for (const field of ["viewport=", "lighting=", "cameraBeforeNativeCapture="])
					assert(code.includes(field));
				return {
					viewport: { viewport: "100,100" },
					lighting: { clock: 14 },
					cameraBeforeNativeCapture: { fov: 60 },
				};
			});
			assert.equal(state.cameraBeforeNativeCapture.fov, 60);
			await actions(
				client,
				{ id: "fixture" },
				{ version: 1, steps: [{ kind: "screenshot" }] },
				{ session, outputDir: dir, imagePrefix: "view" + i },
			);
		}
		assert.deepEqual(
			{ discoveries, states, markers, shots, probes },
			{ discoveries: 1, states: 12, markers: 12, shots: 12, probes: 12 },
		);
		fs.writeFileSync(session, JSON.stringify({ studioId: "fixture", status: "running", token: "foreign" }));
		await assert.rejects(
			actions(
				client,
				{ id: "fixture" },
				{ version: 1, steps: [{ kind: "screenshot" }] },
				{ session, outputDir: dir },
			),
			/ownership marker changed/,
		);
		assert.equal(shots, 12);
	} finally {
		assert.equal(path.dirname(dir), temporary);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("capture preserves owned cleanup across input, start and restore failures (injected transport)", async (t) => {
	const { capture } = require("./studio-visual-review.cjs");
	const parent = path.resolve(__dirname, "../build/visual-regression");
	fs.mkdirSync(parent, { recursive: true });
	const root = fs.mkdtempSync(path.join(parent, "case-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, "studio-tools.json"), JSON.stringify({ expectedPlaceId: 123 }));
	const manifest = path.join(root, "views.json");
	fs.writeFileSync(
		manifest,
		JSON.stringify({
			version: 1,
			name: "Mock only",
			views: [{ name: "scene", kind: "world", device: "desktop", position: [0, 5, 10], lookAt: [0, 0, 0] }],
		}),
	);
	for (const failure of ["none", "capture", "start", "restore", "stop", "configure"]) {
		const out = path.join(root, failure);
		const state = { mode: "Edit", starts: 0, stops: 0, restores: 0, snapshots: 0 };
		const runtime = {
			root,
			assertOwnership() {},
			verifyOwnership: async () => {},
			client: {
				async connect() {},
				close() {},
				async call(name) {
					if (name === "list_roblox_studios") return { studios: [{ id: "fixture", placeId: 123 }] };
					if (name === "get_studio_state") return { text: "Current Studio Mode: " + state.mode };
					return {
						robloxStudio: 1,
						ok: true,
						value: { viewport: { viewport: "100,100" }, lighting: { clock: 14 } },
					};
				},
			},
			async lifecycle(client, studio, action) {
				if (action === "start") {
					state.starts++;
					state.mode = "Play";
					if (failure === "start") throw Error("start ambiguous");
				} else {
					state.stops++;
					if (failure === "stop") throw Error("stop ambiguous");
					state.mode = "Edit";
				}
			},
			devices: {
				async snapshot() {
					state.snapshots++;
					return { id: "original" };
				},
				async configure() {
					if (failure === "configure") throw Error("configure failed");
					return { id: "default" };
				},
				async restore() {
					assert.equal(state.mode, "Edit");
					state.restores++;
					if (failure === "restore") throw Error("restore failed");
				},
			},
			async actions() {
				if (failure === "capture") throw Error("capture failed");
				const file = path.join(out, "scene.png");
				fs.writeFileSync(file, "mock capture, not native acceptance");
				return { results: [{ images: [file] }] };
			},
		};
		if (failure === "none") assert.equal((await capture(manifest, out, runtime)).passed, true);
		else await assert.rejects(capture(manifest, out, runtime), /Visual review failed/);
		const report = JSON.parse(fs.readFileSync(path.join(out, "report.json")));
		assert.equal(report.passed, failure === "none");
		assert.equal(state.restores, failure === "stop" ? 0 : 1);
		if (failure === "stop") {
			assert.match(report.cleanupError, /stop ambiguous/);
			assert.equal(state.mode, "Play");
		}
		if (failure === "start") {
			assert.equal(state.starts, 1);
			assert.equal(state.stops, 1);
			assert.match(report.error, /start ambiguous/);
		}
		if (failure === "restore") assert.match(report.restoreError, /restore failed/);
	}
});

test("mobile preset and view sets must be explicit", () => {
	assert.throws(
		() =>
			validate({
				version: 1,
				name: "test",
				views: [{ name: "phone", kind: "world", device: "portrait", position: [0, 0, 1], lookAt: [0, 0, 0] }],
			}),
		/explicit mobile/,
	);
});
