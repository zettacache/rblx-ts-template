#!/usr/bin/env node
// Open Cloud uploads are explicit. No cookies, Studio tokens, or RoPilot services.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
const BASE = "https://apis.roblox.com/assets/v1/";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => sha(JSON.stringify(value));
const { readJson: json } = require("./text-files.cjs");
function write(file, data, exclusive = false) {
	fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(data, null, 2), { flag: exclusive ? "wx" : "w" });
}
function prepare(input, base = process.cwd(), stageRoot = path.join(ROOT, "build", "uploads")) {
	if (
		input.version !== 1 ||
		!["Model", "Animation"].includes(input.assetType) ||
		typeof input.file !== "string" ||
		typeof input.displayName !== "string" ||
		!input.displayName.trim() ||
		input.displayName.length > 100 ||
		typeof input.description !== "string" ||
		input.description.length > 1000
	)
		throw Error("Upload spec needs version:1, Model|Animation, file, displayName, description.");
	const creator = input.creator;
	if (
		!creator ||
		Object.keys(creator).length !== 1 ||
		!Object.entries(creator).every(
			([k, v]) => ["userId", "groupId"].includes(k) && typeof v === "string" && /^[1-9]\d*$/.test(v),
		)
	)
		throw Error('Specify one creator: {userId:"..."} or {groupId:"..."}.');
	const file = path.resolve(base, input.file),
		bytes = fs.readFileSync(file),
		ext = path.extname(file).toLowerCase();
	if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error("Asset must be 1 byte..20 MiB.");
	let mime;
	if (input.assetType === "Model") {
		if (![".fbx", ".glb"].includes(ext)) throw Error("Model upload supports self-contained FBX or GLB.");
		if (
			ext === ".glb" &&
			(bytes.length < 12 ||
				bytes.toString("ascii", 0, 4) !== "glTF" ||
				bytes.readUInt32LE(4) !== 2 ||
				bytes.readUInt32LE(8) !== bytes.length)
		)
			throw Error("Invalid GLB header.");
		if (
			ext === ".fbx" &&
			!bytes.subarray(0, 22).toString().startsWith("Kaydara FBX Binary") &&
			!bytes.subarray(0, 100).toString().includes("FBX")
		)
			throw Error("Invalid FBX header.");
		mime = ext === ".fbx" ? "model/fbx" : "model/gltf-binary";
	} else {
		if (ext !== ".rbxm" || bytes.subarray(0, 8).toString() !== "<roblox!")
			throw Error("Animation upload requires native .rbxm from studio-animation export.");
		const proof = json(file + ".manifest.json");
		if (!proof.native || !proof.verified || proof.artifactSha256 !== sha(bytes))
			throw Error("Native animation verification manifest missing or mismatched.");
		mime = "model/x-rbxm";
	}
	const folder = path.join(stageRoot, randomUUID());
	fs.mkdirSync(folder, { recursive: true });
	const frozen = path.join(folder, "asset" + ext);
	fs.writeFileSync(frozen, bytes, { flag: "wx" });
	const review = {
		version: 1,
		file: frozen,
		sha256: sha(bytes),
		bytes: bytes.length,
		mime,
		request: {
			assetType: input.assetType,
			displayName: input.displayName,
			description: input.description,
			creationContext: { creator, expectedPrice: 0 },
		},
	};
	const result = { ...review, digest: digest(review) };
	const reviewFile = path.join(folder, "review.json");
	write(reviewFile, result, true);
	return { reviewFile, review: result };
}
function verify(review) {
	const { digest: checksum, ...data } = review;
	if (digest(data) !== checksum) throw Error("Upload review changed; prepare again.");
	const bytes = fs.readFileSync(review.file);
	if (bytes.length !== review.bytes || sha(bytes) !== review.sha256)
		throw Error("Reviewed artifact changed.");
	return bytes;
}
function operationPath(value) {
	if (typeof value !== "string" || !/^operations\/[A-Za-z0-9_-]+$/.test(value))
		throw Error("Unexpected operation path; refusing to send credentials to another URL.");
	return value;
}
async function request(url, options, apiKey, fetcher) {
	const response = await fetcher(url, {
		...options,
		headers: { "x-api-key": apiKey },
		redirect: "error",
		signal: AbortSignal.timeout(30000),
	});
	if (!response.ok)
		throw Error(`Open Cloud HTTP ${response.status}. Check key scope, creator permissions, and quota.`);
	return response.json();
}
async function poll(receiptFile, apiKey, fetcher = fetch) {
	if (!apiKey)
		throw Error("Set ROBLOX_OPEN_CLOUD_API_KEY in the process environment; never put it in project files.");
	const receipt = json(receiptFile);
	if (receipt.status === "complete") return receipt;
	if (!receipt.operation)
		throw Error(
			"No operation ID was received; inspect the creator inventory before attempting another upload.",
		);
	const data = await request(BASE + operationPath(receipt.operation), { method: "GET" }, apiKey, fetcher);
	if (data.done === true) {
		if (data.error) {
			receipt.status = "failed";
			receipt.errorCode = String(data.error.code ?? "unknown").slice(0, 100);
		} else {
			const id = String(data.response?.assetId ?? "");
			if (!/^[1-9]\d*$/.test(id)) throw Error("Completed operation returned no valid asset ID.");
			receipt.status = "complete";
			receipt.assetId = id;
			receipt.moderationState = data.response?.moderationResult?.moderationState ?? "unknown";
		}
	} else receipt.status = "processing";
	write(receiptFile, receipt);
	return receipt;
}
async function upload(reviewFile, receiptFile, apiKey, fetcher = fetch) {
	if (!apiKey)
		throw Error("Set ROBLOX_OPEN_CLOUD_API_KEY in the process environment; never put it in project files.");
	const review = json(reviewFile),
		bytes = verify(review);
	const receipt = {
		version: 1,
		status: "sending",
		reviewFile: path.resolve(reviewFile),
		reviewDigest: review.digest,
		assetType: review.request.assetType,
		displayName: review.request.displayName,
		creator: review.request.creationContext.creator,
		artifactSha256: review.sha256,
	};
	// A per-review claim prevents accidental duplicate POSTs, even with another receipt path.
	const claim = reviewFile + ".submitted.json";
	if (fs.existsSync(receiptFile)) throw Error("Receipt already exists; use poll instead of another upload.");
	write(claim, { receiptFile: path.resolve(receiptFile), attemptedAt: new Date().toISOString() }, true);
	write(receiptFile, receipt, true);
	try {
		const form = new FormData();
		form.set("request", JSON.stringify(review.request));
		form.set("fileContent", new Blob([bytes], { type: review.mime }), path.basename(review.file));
		const result = await request(BASE + "assets", { method: "POST", body: form }, apiKey, fetcher);
		receipt.operation = operationPath(result.path);
		receipt.status = "processing";
		write(receiptFile, receipt);
	} catch (e) {
		receipt.status = "unconfirmed";
		write(receiptFile, receipt);
		throw Error(`${e.message} Upload was not retried. Receipt: ${receiptFile}`, { cause: e });
	}
	return poll(receiptFile, apiKey, fetcher);
}
async function main(argv = process.argv.slice(2)) {
	if (!argv.length || argv[0] === "--help")
		return console.log(
			"studio-assets.cjs prepare <upload.json> | upload <review.json> --receipt <new.json> | poll <receipt.json>\nprepare is offline. upload explicitly creates a cloud asset and never retries POST. API key: ROBLOX_OPEN_CLOUD_API_KEY.",
		);
	let result;
	if (argv[0] === "prepare" && argv.length === 2)
		result = prepare(json(argv[1]), path.dirname(path.resolve(argv[1])));
	else if (argv[0] === "upload" && argv.length === 4 && argv[2] === "--receipt")
		result = await upload(argv[1], argv[3], process.env.ROBLOX_OPEN_CLOUD_API_KEY);
	else if (argv[0] === "poll" && argv.length === 2)
		result = await poll(argv[1], process.env.ROBLOX_OPEN_CLOUD_API_KEY);
	else throw Error("Invalid asset command.");
	console.log(JSON.stringify(result, null, 2));
	if (result.status === "failed") process.exitCode = 1;
}
if (require.main === module)
	main().catch((e) => {
		console.error(JSON.stringify({ error: e.message }));
		process.exitCode = 1;
	});
module.exports = { prepare, verify, operationPath, upload, poll };
