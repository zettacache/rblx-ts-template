#!/usr/bin/env node
// Native, signed-in Studio upload for flat-colored Blender triangle exports.
// Ownership is always the target experience's creator; never copies credentials.
const fs = require("node:fs"),
	path = require("node:path"),
	crypto = require("node:crypto");
const { decodeText, readJson } = require("./text-files.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { luaString, decodeResult } = require("./studio-author.cjs");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function validate(data) {
	if (
		!data ||
		data.version !== 1 ||
		typeof data.name !== "string" ||
		!data.name.trim() ||
		data.name.length > 70 ||
		!Array.isArray(data.triangles) ||
		!data.triangles.length ||
		data.triangles.length > 10000
	)
		throw Error("Expected version 1, name and 1..10000 triangles.");
	for (const t of data.triangles) {
		if (
			!t ||
			!Array.isArray(t.vertices) ||
			t.vertices.length !== 3 ||
			t.vertices.some(
				(v) =>
					!Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isFinite(n) || Math.abs(n) > 10000),
			) ||
			!Array.isArray(t.color) ||
			t.color.length !== 3 ||
			t.color.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
		)
			throw Error("Invalid triangle coordinates or color.");
		const a = t.vertices[1].map((n, i) => n - t.vertices[0][i]),
			b = t.vertices[2].map((n, i) => n - t.vertices[0][i]);
		if (Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) < 1e-6)
			throw Error("Degenerate triangle.");
	}
	return data;
}
function bounds(data) {
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	for (const t of data.triangles)
		for (const v of t.vertices)
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], v[i]);
				max[i] = Math.max(max[i], v[i]);
			}
	return { min, max, center: min.map((n, i) => (n + max[i]) / 2), size: min.map((n, i) => max[i] - n) };
}
function prepare(file, output, center = false) {
	file = path.resolve(file);
	output = path.resolve(output);
	const metadata = output + ".origin.json";
	if (file === output || file === metadata) throw Error("Prepared geometry must not overwrite its source.");
	const source = fs.readFileSync(file),
		data = validate(JSON.parse(decodeText(source, file))),
		original = bounds(data);
	const offset = center ? original.center : [0, 0, 0];
	for (const t of data.triangles) for (const v of t.vertices) for (let i = 0; i < 3; i++) v[i] -= offset[i];
	validate(data);
	const bytes = Buffer.from(JSON.stringify(data));
	const report = {
		version: 1,
		name: data.name,
		sourceSha256: hash(source),
		sha256: hash(bytes),
		centered: center,
		originalBounds: original,
		uploadBounds: bounds(data),
		partPositionForOriginalPlacement: offset,
		note: "CreateMeshPartAsync preserves vertex origin; place the part at this offset to reproduce the source geometry.",
	};
	const metaBytes = Buffer.from(JSON.stringify(report, null, 2));
	if (fs.existsSync(output) || fs.existsSync(metadata)) {
		if (
			!fs.existsSync(output) ||
			!fs.existsSync(metadata) ||
			!fs.readFileSync(output).equals(bytes) ||
			!fs.readFileSync(metadata).equals(metaBytes)
		)
			throw Error(
				"Prepared output already exists with different or incomplete content. Choose a new output path.",
			);
		return { output, metadata, reused: true, ...report };
	}
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, bytes, { flag: "wx" });
	try {
		fs.writeFileSync(metadata, metaBytes, { flag: "wx" });
	} catch (error) {
		fs.unlinkSync(output);
		throw error;
	}
	return { output, metadata, reused: false, ...report };
}
async function upload(file, receiptFile, providedClient) {
	const started = performance.now(),
		timings = {};
	const bytes = fs.readFileSync(file),
		data = validate(JSON.parse(decodeText(bytes, file))),
		sha256 = hash(bytes);
	const geometry = bounds(data);
	const thin = geometry.size.map((size, i) => (size < 0.05 - 1e-6 ? "XYZ"[i] : null)).filter(Boolean);
	if (thin.length)
		throw Error(
			"Mesh bounds are below 0.05 studs on " +
				thin.join("/") +
				". Add thickness in the source recipe before upload; centering alone does not add thickness. No upload attempted.",
		);
	const client = providedClient || new McpClient(findBridge(), ["--stdio"], 120000);
	let receipt;
	const save = () => fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
	try {
		// A supplied client is already connected and remains owned by its caller.
		if (!providedClient) await client.connect();
		const studio = chooseStudio(
			await client.call("list_roblox_studios"),
			undefined,
			require("./studio-config.cjs").read().expectedPlaceId,
		);
		const expected = String(require("./studio-config.cjs").read().expectedPlaceId);
		const exec = async (code) =>
			decodeResult(
				await client.call("execute_luau", {
					studio_id: studio.id,
					datamodel_type: "Edit",
					code: `assert(tostring(game.PlaceId)==${luaString(expected)},'Studio target changed; no asset mutation allowed');assert(not game:GetService('RunService'):IsRunning(),'Edit mode required')\nlocal function work()\n${code}\nend\nreturn game:GetService('HttpService'):JSONEncode({robloxStudio=1,ok=true,value=work()})`,
				}),
			).value;
		const owner = await exec(
			`assert(game.GameId>0 and game.CreatorId>0,'Published experience identity required')\nreturn {placeId=tostring(game.PlaceId),universeId=tostring(game.GameId),creatorId=tostring(game.CreatorId),creatorType=game.CreatorType.Name}`,
		);
		timings.discoveryMs = performance.now() - started;
		const creationStarted = performance.now();
		if (fs.existsSync(receiptFile)) {
			receipt = readJson(receiptFile);
			if (receipt.sha256 !== sha256 || Object.keys(owner).some((k) => receipt.owner?.[k] !== owner[k]))
				throw Error("Receipt belongs to different content or experience. Use a new receipt for a new asset.");
			if (receipt.status !== "uploaded" && receipt.status !== "verified")
				throw Error(
					"Previous upload is incomplete; inspect its receipt and creator inventory before another creation attempt.",
				);
		} else {
			receipt = {
				version: 1,
				status: "sending",
				sha256,
				owner,
				name: data.name,
				triangles: data.triangles.length,
				geometry,
				attemptedAt: new Date().toISOString(),
			};
			fs.mkdirSync(path.dirname(path.resolve(receiptFile)), { recursive: true });
			fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { flag: "wx" });
			// One creation call. An ambiguous transport failure must not create a duplicate.
			const result =
				await exec(`local data=game:GetService('HttpService'):JSONDecode(${luaString(JSON.stringify(data))})
local service=game:GetService('AssetService')
local mesh=assert(service:CreateEditableMesh(),'Editable mesh allocation failed')
local ok,result,id=pcall(function()
 for _,t in data.triangles do
  local v={}
  for _,p in t.vertices do table.insert(v,mesh:AddVertex(Vector3.new(unpack(p)))) end
  local face=mesh:AddTriangle(unpack(v))
  local color=mesh:AddColor(Color3.new(unpack(t.color)),1)
  mesh:SetFaceColors(face,{color,color,color})
  local a,b,c=Vector3.new(unpack(t.vertices[1])),Vector3.new(unpack(t.vertices[2])),Vector3.new(unpack(t.vertices[3]))
  local normal=mesh:AddNormal((b-a):Cross(c-a).Unit)
  mesh:SetFaceNormals(face,{normal,normal,normal})
 end
 return service:CreateAssetAsync(mesh,Enum.AssetType.Mesh,{Name='Roblox '..data.name,
  Description='Blender-authored project mesh.',CreatorId=game.CreatorId,CreatorType=Enum.AssetCreatorType[game.CreatorType.Name]})
end)
mesh:Destroy()
return {success=ok and result==Enum.CreateAssetResult.Success,result=tostring(result),assetId=ok and tostring(id) or '',error=not ok and tostring(result) or nil}`);
			if (!result.success) {
				receipt.status = "failed";
				receipt.result = result;
				save();
				throw Error("Studio asset upload failed: " + JSON.stringify(result));
			}
			if (!/^[1-9]\d*$/.test(result.assetId))
				throw Error("Upload returned no valid asset ID; receipt retained for recovery.");
			receipt.status = "uploaded";
			receipt.assetId = result.assetId;
			save();
		}
		// Same-creator ownership supplies experience usage permission. Verify metadata
		// and perform a fresh cloud load; don't enable third-party loading or public use.
		if (!/^[1-9]\d*$/.test(receipt.assetId) || !Number.isSafeInteger(Number(receipt.assetId)))
			throw Error("Receipt contains an invalid asset ID.");
		timings.creationOrReceiptMs = performance.now() - creationStarted;
		const verificationStarted = performance.now();
		receipt.verification = await exec(`local id=${Number(receipt.assetId)}
local info=game:GetService('MarketplaceService'):GetProductInfoAsync(id,Enum.InfoType.Asset)
assert(info.AssetTypeId==Enum.AssetType.Mesh.Value,'Uploaded asset is not a mesh')
assert(tostring(info.Creator.CreatorTargetId)==tostring(game.CreatorId),'Uploaded asset creator mismatch')
assert(info.Creator.CreatorType==game.CreatorType.Name,'Uploaded asset owner type mismatch')
local part=game:GetService('AssetService'):CreateMeshPartAsync(Content.fromUri('rbxassetid://'..id),{CollisionFidelity=Enum.CollisionFidelity.Box})
local size={part.Size.X,part.Size.Y,part.Size.Z}
local center=part.CFrame:PointToObjectSpace(part.ExtentsCFrame.Position)
local sizeError=(part.Size-Vector3.new(${geometry.size.join(",")})).Magnitude
local originError=(center-Vector3.new(${geometry.center.join(",")})).Magnitude
part:Destroy()
assert(sizeError<.004,'Cloud mesh size does not match uploaded geometry')
assert(originError<.004,'Cloud mesh origin does not match uploaded geometry')
return {permission='experience-creator-owned',assetTypeId=info.AssetTypeId,creatorId=tostring(info.Creator.CreatorTargetId),size=size,origin={center.X,center.Y,center.Z},cloudLoad=true}`);
		timings.verificationMs = performance.now() - verificationStarted;
		timings.totalMs = performance.now() - started;
		receipt.status = "verified";
		receipt.timings = timings;
		save();
		return receipt;
	} finally {
		if (!providedClient) client.close();
	}
}
async function uploadBatch(
	entries,
	{ onProgress, createClient = () => new McpClient(findBridge(), ["--stdio"], 120000) } = {},
) {
	if (!Array.isArray(entries) || !entries.length) throw Error("Mesh batch requires at least one entry.");
	if (entries.some((e) => !e || typeof e.file !== "string" || typeof e.receipt !== "string"))
		throw Error("Mesh batch entries require file and receipt paths.");
	const receipts = new Set(),
		sources = new Set(entries.map((e) => path.resolve(e.file).toLowerCase()));
	for (const entry of entries) {
		const target = path.resolve(entry.receipt).toLowerCase();
		if (receipts.has(target) || sources.has(target))
			throw Error("Duplicate receipt or source overwrite in mesh batch.");
		receipts.add(target);
		const data = validate(readJson(entry.file));
		if (bounds(data).size.some((n) => n < 0.05 - 1e-6))
			throw Error("Mesh bounds are below 0.05 studs. No batch upload attempted.");
	}
	const client = createClient(),
		started = performance.now(),
		results = [];
	try {
		await client.connect();
		for (const entry of entries) {
			const receipt = await upload(entry.file, entry.receipt, client);
			results.push({
				file: entry.file,
				receipt: entry.receipt,
				status: receipt.status,
				assetId: receipt.assetId,
				timings: receipt.timings,
			});
			if (onProgress) await onProgress(results.at(-1), entry);
		}
		return { results, totalMs: performance.now() - started, bridgeTimings: client.timingSummary?.() };
	} finally {
		client.close();
	}
}
async function main(argv = process.argv.slice(2)) {
	const help =
		"studio-mesh-assets.cjs prepare <triangles.json> --out <mesh.json> [--center]\nstudio-mesh-assets.cjs upload <triangles.json> --receipt <asset.json>\nstudio-mesh-assets.cjs batch <batch.json> (array of {file,receipt}, relative to batch file; reuses successful receipts)";
	if (!argv.length || argv[0] === "--help") return console.log(help);
	if (argv[0] === "batch" && argv.length === 2) {
		const base = path.dirname(path.resolve(argv[1])),
			entries = readJson(argv[1]);
		if (!Array.isArray(entries)) throw Error("Mesh batch must be an array.");
		return console.log(
			JSON.stringify(
				await uploadBatch(
					entries.map((e) => ({
						...e,
						file: path.resolve(base, e.file),
						receipt: path.resolve(base, e.receipt),
					})),
				),
				null,
				2,
			),
		);
	}
	if (argv[0] === "prepare") {
		if (![4, 5].includes(argv.length) || argv[2] !== "--out" || (argv[4] && argv[4] !== "--center"))
			throw Error(help);
		return console.log(JSON.stringify(prepare(argv[1], argv[3], argv[4] === "--center"), null, 2));
	}
	if (argv.length !== 4 || argv[0] !== "upload" || argv[2] !== "--receipt") throw Error(help);
	console.log(JSON.stringify(await upload(argv[1], argv[3]), null, 2));
}
if (require.main === module)
	main().catch((e) => {
		console.error(e.message);
		process.exitCode = 1;
	});
module.exports = { validate, bounds, prepare, upload, uploadBatch };
