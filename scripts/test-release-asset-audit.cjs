const test = require("node:test"),
	assert = require("node:assert/strict"),
	fs = require("node:fs"),
	path = require("node:path"),
	crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { parsePlace, inventory, receipts, compareSources, assetId } = require("./release-asset-audit.cjs");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const temporary = path.resolve(__dirname, "../build/test-temp");
fs.mkdirSync(temporary, { recursive: true });

function fixture(t) {
	const root = fs.mkdtempSync(path.join(temporary, "release-audit-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}
const item = (ref, name, body = "", children = "", kind = "Part") =>
	`<Item class="${kind}" referent="${ref}"><Properties><string name="Name">${name}</string>${body}</Properties>${children}</Item>`;
test("real XML parser retains duplicate names, CDATA, nested asset URI, false flags and service scope", (t) => {
	const root = fixture(t),
		file = path.join(root, "place.rbxlx");
	fs.writeFileSync(
		file,
		`<roblox>${item("w", "Workspace", "", item("a", "A", '<bool name="Anchored">false</bool><bool name="CanCollide">true</bool><Content name="MeshContent"><uri>rbxassetid://123</uri></Content>', "", "MeshPart") + item("b", "A", "", "", "Part"), "Workspace")}${item("s", "ServerStorage", "", item("m", "Secret", "", "", "MeshPart"), "ServerStorage")}${item("l", "Logic", '<ProtectedString name="Source"><![CDATA[local s="<Item>"; -- rbxassetid://123\n]]></ProtectedString>', "", "ModuleScript")}</roblox>`,
	);
	const rows = parsePlace(file),
		result = inventory(rows);
	assert.equal(rows.length, 6);
	assert.equal(rows[2].path, "Workspace[0]/A[1]");
	assert.match(rows[5].source, /<Item>/);
	assert.equal(result.physics.workspaceBaseParts, 2);
	assert.equal(result.physics.workspaceUnanchored, 1);
	assert.equal(result.physics.workspaceCanCollide, 1);
	assert.equal(result.physics.missingExplicitFlags.Anchored, 1);
	assert.equal(result.services.ServerStorage.serializedClientCandidate, false);
	assert.equal(result.assets.length, 1);
	assert.equal(result.assets[0].propertyReferences, 1);
	assert.equal(result.assets[0].sourceLiteralReferences, 1);
});
test("invalid XML and ambiguous referents fail instead of producing partial inventory", (t) => {
	const root = fixture(t),
		file = path.join(root, "bad.rbxlx");
	for (const xml of [
		"<roblox><Item>",
		"<other/>",
		"<roblox/>",
		`<roblox>${item("a", "A")}${item("a", "B")}</roblox>`,
	]) {
		fs.writeFileSync(file, xml);
		assert.throws(() => parsePlace(file));
	}
});
test("native source comparison detects stale and missing sources with normalized CRLF", (t) => {
	const root = fixture(t),
		dir = path.join(root, "studio", "ReplicatedFirst");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "Loading.client.luau"), 'print("ok")\r\n');
	const row = { path: "ReplicatedFirst[0]/Loading[0]", className: "LocalScript", source: 'print("ok")\n' };
	assert.equal(compareSources(root, [row]).matched.length, 1);
	assert.equal(compareSources(root, [{ ...row, source: "stale" }]).mismatches.length, 1);
	assert.equal(compareSources(root, []).mismatches[0].candidates, 0);
});
test("local geometry coverage requires matching mesh hash and handles conflicting receipts", (t) => {
	const root = fixture(t),
		dir = path.join(root, "assets", "example");
	fs.mkdirSync(dir, { recursive: true });
	const geometry = JSON.stringify({ triangles: Array(94).fill({ vertices: [] }) });
	fs.writeFileSync(path.join(dir, "Body.mesh.json"), geometry);
	fs.writeFileSync(
		path.join(dir, "Body.asset.json"),
		JSON.stringify({
			assetId: "123",
			triangles: 94,
			sha256: sha(geometry),
			status: "verified",
			verification: { cloudLoad: true },
		}),
	);
	const receipt = receipts(root);
	assert.equal(receipt[0].geometryHashMatched, true);
	const rows = [
		{
			path: "Workspace[0]/M[0]",
			className: "MeshPart",
			properties: {},
			assets: [{ property: "MeshContent", value: "rbxassetid://123" }],
		},
	];
	assert.equal(inventory(rows, receipt).geometry.knownMeshInstanceTriangles, 94);
	assert.equal(
		inventory(rows, [{ ...receipt[0], geometryHashMatched: false }]).geometry.coveredMeshInstances,
		0,
	);
	assert.equal(
		inventory(rows, [...receipt, { ...receipt[0], triangles: 100 }]).geometry.conflictingTriangleReceipts,
		1,
	);
	assert.equal(inventory(rows).assets[0].localVerifiedInputTriangles, null);
	fs.writeFileSync(path.join(dir, "Broken.asset.json"), "{broken");
	assert.throws(() => receipts(root));
});
test("content IDs reject unrelated URLs and CLI errors fail without writing outside output directory", (t) => {
	assert.equal(assetId("https://www.roblox.com/asset/?id=123"), "123");
	assert.equal(assetId("https://example.com/?id=123"), null);
	const root = fixture(t),
		out = path.join(root, "report.json");
	const r = spawnSync(process.execPath, [path.join(__dirname, "release-asset-audit.cjs"), "--out", out], {
		encoding: "utf8",
		windowsHide: true,
	});
	assert.equal(r.status, 1);
	assert.match(r.stderr, /output must be under/);
	assert.equal(fs.existsSync(out), false);
});

test("mapped compiled scripts are compared while specs stay excluded", (t) => {
	const root = fixture(t);
	fs.mkdirSync(path.join(root, "out/server"), { recursive: true });
	fs.writeFileSync(path.join(root, "out/server/main.server.luau"), 'print("compiled")\n');
	fs.writeFileSync(path.join(root, "out/server/hidden.spec.luau"), "test only");
	fs.writeFileSync(
		path.join(root, "default.project.json"),
		JSON.stringify({ tree: { ServerScriptService: { TS: { $path: "out/server" } } } }),
	);
	const row = {
		path: "ServerScriptService[0]/TS[0]/main[0]",
		className: "Script",
		source: 'print("compiled")\n',
	};
	assert.equal(compareSources(root, [row]).matched.length, 1);
	assert.equal(compareSources(root, [{ ...row, source: "old" }]).mismatches.length, 1);
	assert.equal(compareSources(root, []).mismatches.length, 1);
});
