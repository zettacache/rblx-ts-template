// Isolated test process: fictitious place, never a live upload target.
const injectedConfig = require("./studio-config.cjs");
const originalReadConfig = injectedConfig.read;
injectedConfig.read = (root) =>
	!root || require("node:path").resolve(root) === require("node:path").resolve(__dirname, "..")
		? { expectedPlaceId: "123456789" }
		: originalReadConfig(root);
const test = require("node:test"),
	assert = require("node:assert/strict"),
	fs = require("node:fs"),
	path = require("node:path"),
	os = require("node:os");
const { validate, bounds, prepare, upload, uploadBatch } = require("./studio-mesh-assets.cjs");
const geometry = () => ({
	version: 1,
	name: "Fixture",
	triangles: [
		{
			vertices: [
				[0, 0, 0],
				[1, 0, 0],
				[0, 1, 0],
			],
			color: [0.2, 0.3, 0.4],
		},
	],
});
function fixture(t, flat = false) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roblox-native-mesh-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "mesh.json");
	const mesh = geometry();
	if (!flat) mesh.triangles[0].vertices[2][2] = 1;
	fs.writeFileSync(file, JSON.stringify(mesh));
	return { file, receipt: path.join(dir, "receipt.json") };
}
function peer(options = {}) {
	let created = 0,
		verified = 0;
	const owner = {
		placeId: String(require("./studio-config.cjs").read().expectedPlaceId),
		universeId: "67890",
		creatorId: "12345",
		creatorType: "User",
	};
	return {
		get created() {
			return created;
		},
		get verified() {
			return verified;
		},
		async connect() {},
		close() {},
		async call(name, args) {
			if (name === "list_roblox_studios")
				return {
					studios: [
						{ id: "fixture", name: "placeId: " + require("./studio-config.cjs").read().expectedPlaceId },
					],
				};
			assert.equal(args.datamodel_type, "Edit");
			assert.match(args.code, /not game:GetService\('RunService'\):IsRunning/);
			assert.match(args.code, /assert\(tostring\(game.PlaceId\)==/);
			assert.match(args.code, /Studio target changed; no asset mutation allowed/);
			let value;
			if (args.code.includes("local data=")) {
				created++;
				assert.match(args.code, /CreatorId=game.CreatorId/);
				assert.match(args.code, /CreatorType=Enum.AssetCreatorType\[game.CreatorType.Name\]/);
				if (options.disconnect) throw Error("transport disconnected");
				value = options.deny
					? { success: false, result: "PermissionDenied" }
					: { success: true, assetId: "1234567" };
			} else if (args.code.includes("GetProductInfoAsync")) {
				assert.match(args.code, /sizeError<.004/);
				assert.match(args.code, /originError<.004/);
				assert.match(args.code, /part:Destroy\(\)/);
				verified++;
				if (options.verifyFail) throw Error("cloud load pending");
				value = { permission: "experience-creator-owned", cloudLoad: true };
			} else value = options.otherOwner ? { ...owner, creatorId: "999" } : { ...owner };
			return { robloxStudio: 1, ok: true, value };
		},
	};
}
test("reject malformed or degenerate mesh before upload", () => {
	const m = geometry();
	m.triangles[0].vertices[2] = [2, 0, 0];
	assert.throws(() => validate(m), /Degenerate/);
	const c = geometry();
	c.triangles[0].color[0] = Infinity;
	assert.throws(() => validate(c), /Invalid/);
});
test("native upload verifies ownership and reruns reuse the same asset", async (t) => {
	const f = fixture(t),
		p = peer();
	assert.equal((await upload(f.file, f.receipt, p)).status, "verified");
	const receipt = JSON.parse(fs.readFileSync(f.receipt));
	receipt.owner = Object.fromEntries(Object.entries(receipt.owner).reverse());
	fs.writeFileSync(f.receipt, JSON.stringify(receipt));
	await upload(f.file, f.receipt, p);
	assert.equal(p.created, 1);
	assert.equal(p.verified, 2);
	await assert.rejects(
		upload(f.file, f.receipt, peer({ otherOwner: true })),
		/different content or experience/,
	);
	const changed = JSON.parse(fs.readFileSync(f.file));
	changed.name = "Changed";
	fs.writeFileSync(f.file, JSON.stringify(changed));
	await assert.rejects(upload(f.file, f.receipt, p), /different content or experience/);
	assert.equal(p.created, 1);
});
test("ambiguous creation failures never retry automatically", async (t) => {
	const f = fixture(t),
		p = peer({ disconnect: true });
	await assert.rejects(upload(f.file, f.receipt, p), /disconnected/);
	await assert.rejects(upload(f.file, f.receipt, p), /Previous upload is incomplete/);
	assert.equal(p.created, 1);
});
test("permission failure retains a non-retryable receipt", async (t) => {
	const f = fixture(t),
		p = peer({ deny: true });
	await assert.rejects(upload(f.file, f.receipt, p), /PermissionDenied/);
	assert.equal(JSON.parse(fs.readFileSync(f.receipt)).status, "failed");
	await assert.rejects(upload(f.file, f.receipt, p), /Previous upload is incomplete/);
	assert.equal(p.created, 1);
});
test("verification can resume without a second asset creation", async (t) => {
	const f = fixture(t),
		p = peer({ verifyFail: true });
	await assert.rejects(upload(f.file, f.receipt, p), /cloud load pending/);
	assert.equal(JSON.parse(fs.readFileSync(f.receipt)).status, "uploaded");
	const retry = peer();
	await upload(f.file, f.receipt, retry);
	assert.equal(retry.created, 0);
	assert.equal(retry.verified, 1);
});
test("centered preparation preserves source geometry through explicit placement metadata", (t) => {
	const f = fixture(t, true),
		original = fs.readFileSync(f.file),
		output = path.join(path.dirname(f.file), "centered.json");
	const result = prepare(f.file, output, true),
		prepared = JSON.parse(fs.readFileSync(output));
	assert.deepEqual(result.partPositionForOriginalPlacement, [0.5, 0.5, 0]);
	assert.deepEqual(bounds(prepared).center, [0, 0, 0]);
	assert.deepEqual(bounds(prepared).size, [1, 1, 0]);
	for (let i = 0; i < 3; i++)
		assert.deepEqual(
			prepared.triangles[0].vertices[i].map((n, j) => n + result.partPositionForOriginalPlacement[j]),
			geometry().triangles[0].vertices[i],
		);
	assert.ok(fs.readFileSync(f.file).equals(original));
	assert.equal(prepare(f.file, output, true).reused, true);
	prepared.name = "changed";
	fs.writeFileSync(output, JSON.stringify(prepared));
	assert.throws(() => prepare(f.file, output, true), /different or incomplete/);
});
test("preparation can preserve authored origin and rejects source overwrite and incomplete output", (t) => {
	const f = fixture(t, true),
		output = path.join(path.dirname(f.file), "preserved.json");
	assert.throws(() => prepare(f.file, f.file, true), /overwrite/);
	const result = prepare(f.file, output);
	assert.deepEqual(result.partPositionForOriginalPlacement, [0, 0, 0]);
	assert.deepEqual(result.uploadBounds.center, [0.5, 0.5, 0]);
	fs.unlinkSync(output + ".origin.json");
	assert.throws(() => prepare(f.file, output), /incomplete/);
	assert.throws(() => validate(null), /Expected version/);
	assert.throws(() => validate({ ...geometry(), triangles: [null] }), /Invalid triangle/);
});

test("flat and undersized geometry fails before connecting or creating a receipt", async (t) => {
	const f = fixture(t, true);
	let connected = false;
	const client = {
		async connect() {
			connected = true;
			throw Error("Must not connect");
		},
		close() {},
	};
	await assert.rejects(upload(f.file, f.receipt, client), /Add thickness.*No upload attempted/);
	const mesh = geometry();
	mesh.triangles[0].vertices[2][2] = 0.01;
	fs.writeFileSync(f.file, JSON.stringify(mesh));
	await assert.rejects(upload(f.file, f.receipt, client), /0.05 studs on Z/);
	assert.equal(connected, false);
	assert.equal(fs.existsSync(f.receipt), false);
});

test("mesh batch connects once, verifies each part, and closes only its own client", async (t) => {
	const a = fixture(t),
		b = fixture(t),
		p = peer();
	let connects = 0,
		closes = 0;
	p.connect = async () => {
		connects++;
	};
	p.close = () => {
		closes++;
	};
	const entries = [a, b].map((f) => ({ file: f.file, receipt: f.receipt }));
	const result = await uploadBatch(entries, { createClient: () => p });
	assert.equal(connects, 1);
	assert.equal(closes, 1);
	assert.equal(p.created, 2);
	assert.equal(p.verified, 2);
	assert.equal(result.results.length, 2);
	assert.ok(result.results.every((r) => r.timings.verificationMs >= 0));
	await upload(a.file, a.receipt, p);
	assert.equal(connects, 1);
	assert.equal(closes, 1, "borrowed clients are never closed");
});
test("mesh batch stops after ambiguous creation and closes on failure", async (t) => {
	const a = fixture(t),
		b = fixture(t),
		p = peer({ disconnect: true });
	let closes = 0;
	p.close = () => {
		closes++;
	};
	await assert.rejects(uploadBatch([a, b], { createClient: () => p }), /disconnected/);
	assert.equal(p.created, 1);
	assert.equal(closes, 1);
	assert.equal(fs.existsSync(b.receipt), false);
	await assert.rejects(uploadBatch([a, b], { createClient: () => p }), /incomplete/);
	assert.equal(p.created, 1);
	assert.equal(closes, 2);
});
test("mesh batch validates every geometry and duplicate receipt before connecting", async (t) => {
	const a = fixture(t),
		flat = fixture(t, true),
		createClient = () => assert.fail("Must validate offline");
	await assert.rejects(uploadBatch([a, flat], { createClient }), /0.05/);
	await assert.rejects(uploadBatch([a, a], { createClient }), /Duplicate/);
	await assert.rejects(
		uploadBatch([{ ...a, receipt: flat.file }, flat], { createClient }),
		/source overwrite/,
	);
	await assert.rejects(uploadBatch([], { createClient }), /at least one/);
});
