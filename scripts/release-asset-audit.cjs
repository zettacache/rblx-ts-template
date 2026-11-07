#!/usr/bin/env node
// Offline inventory. XML extraction follows verify-playtest-freeze.py's
// ElementTree Item/Properties walk; use the real XML parser, never regex XML.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { snapshot } = require("./tooling-snapshot.cjs");
const { readText } = require("./text-files.cjs");
const ROOT = path.resolve(__dirname, "..");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const digest = (value) => sha(JSON.stringify(value));
const normalize = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const XML = String.raw`
import sys,json,hashlib,xml.etree.ElementTree as ET
document=ET.parse(sys.argv[1]).getroot()
if document.tag!='roblox': raise ValueError('Expected roblox XML root')
rows=[]; referents=set()
def visit(parent,prefix=''):
    counts={}
    for item in parent.findall('Item'):
        props=item.find('Properties')
        name=item.find("Properties/*[@name='Name']")
        if name is None or name.text is None: raise ValueError('Item missing Name')
        ref=item.get('referent')
        if not ref or ref in referents: raise ValueError('Missing/duplicate referent')
        referents.add(ref)
        n=counts.get(name.text,0);counts[name.text]=n+1
        full=prefix+'/'+name.text+'['+str(n)+']'
        row={'path':full.lstrip('/'),'className':item.get('class'),'properties':{},'assets':[]}
        for p in props:
            key=p.get('name','')
            value=''.join(p.itertext())
            if key=='Source':
                source=value.replace('\r\n','\n')
                row['source']=source
                continue
            if p.tag in ('bool','token','float','double','int','int64','string') or key in ('MeshContent','MeshId','TextureContent','TextureID','TextureId','Texture','Image','SoundId','AnimationId'):
                row['properties'][key]=value
            if p.tag in ('Content','ContentId'):
                for child in p:
                    if child.tag in ('url','uri') and child.text:row['assets'].append({'property':key,'value':child.text})
        rows.append(row);visit(item,full)
visit(document)
if not rows: raise ValueError('Place has no instances')
print(json.dumps(rows,separators=(',',':')))
`;
function parsePlace(file, python = process.platform === "win32" ? "python" : "python3") {
	return JSON.parse(
		execFileSync(python, ["-c", XML, file], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			maxBuffer: 128 * 1024 * 1024,
			timeout: 120000,
		}),
	);
}
function files(root) {
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((e) => {
			if (e.isSymbolicLink()) throw Error("Source symlink refused: " + e.name);
			const full = path.join(root, e.name);
			return e.isDirectory() ? files(full) : [full];
		});
}
const assetId = (value) =>
	/^(?:rbxassetid:\/\/)(\d+)$/.exec(value)?.[1] ||
	/^https?:\/\/(?:www\.)?roblox\.com\/asset\/?\?id=(\d+)$/i.exec(value)?.[1] ||
	null;
const BASE = new Set([
	"Part",
	"MeshPart",
	"WedgePart",
	"CornerWedgePart",
	"TrussPart",
	"UnionOperation",
	"NegateOperation",
	"Seat",
	"VehicleSeat",
	"SpawnLocation",
]);
const CLIENT = new Set([
	"Workspace",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Lighting",
	"SoundService",
]);
function receipts(root) {
	const result = [];
	const all = files(path.join(root, "assets")),
		geometryByHash = new Map();
	for (const file of all.filter((f) =>
		/\.mesh\.json$|[\\/]meshes[\\/].*\.json$|[\\/]mesh-centered\.json$/i.test(f),
	)) {
		const data = fs.readFileSync(file),
			geometry = JSON.parse(normalize(data.toString("utf8")));
		if (Array.isArray(geometry.triangles))
			geometryByHash.set(sha(data), {
				file: path.relative(root, file).replaceAll("\\", "/"),
				triangles: geometry.triangles.length,
			});
	}
	for (const file of all.filter(
		(f) =>
			/\b(?:asset|assets|receipt|receipts|installed-assets)[^/\\]*\.json$/i.test(path.basename(f)) ||
			/[\\/]receipts[\\/].*\.json$/i.test(f),
	)) {
		const value = JSON.parse(readText(file));
		const visit = (v, pointer) => {
			if (!v || typeof v !== "object") return;
			const id = v.assetId ? String(v.assetId) : typeof v.id === "string" ? assetId(v.id) : null;
			if (id && /^\d+$/.test(id)) {
				const geometry = geometryByHash.get(v.sha256),
					mesh = file.replace(/\.asset\.json$/, ".mesh.json");
				const geometryHashMatched = geometry ? true : mesh !== file && fs.existsSync(mesh) ? false : null;
				if (geometry && Number.isInteger(v.triangles) && geometry.triangles !== v.triangles)
					throw Error("Receipt triangle count differs from hashed input: " + file);
				result.push({
					assetId: id,
					file: path.relative(root, file).replaceAll("\\", "/"),
					pointer,
					status: v.status ?? null,
					sha256: v.sha256 ?? null,
					triangles: geometry?.triangles ?? (Number.isInteger(v.triangles) ? v.triangles : null),
					geometryHashMatched,
					geometryFile: geometry?.file ?? null,
					cloudLoadRecorded: v.verification?.cloudLoad === true,
					receiptSha256: sha(fs.readFileSync(file)),
				});
			}
			for (const [k, child] of Object.entries(v))
				if (child && typeof child === "object") visit(child, pointer + "/" + k);
		};
		visit(value, "");
	}
	return result;
}
function inventory(rows, receiptRows = []) {
	const classes = {},
		services = {},
		groups = {},
		assets = new Map(),
		scripts = [],
		workspaceSettings = {},
		fidelity = { collision: {}, render: {} },
		physics = {
			baseParts: 0,
			workspaceBaseParts: 0,
			workspaceUnanchored: 0,
			workspaceCanCollide: 0,
			workspaceCanTouch: 0,
			workspaceCanQuery: 0,
			workspaceCastShadow: 0,
			missingExplicitFlags: {},
		};
	const partFlags = ["Anchored", "CanCollide", "CanTouch", "CanQuery", "CastShadow"];
	const addAsset = (value, owner, property, kind) => {
		const id = assetId(value);
		if (!id) return;
		const r = assets.get(id) || {
			id,
			propertyReferences: 0,
			sourceLiteralReferences: 0,
			properties: {},
			services: {},
			examples: [],
		};
		r[kind === "source" ? "sourceLiteralReferences" : "propertyReferences"]++;
		r.properties[property] = (r.properties[property] || 0) + 1;
		const service = owner.split("/")[0].replace(/\[\d+\]$/, "");
		r.services[service] = (r.services[service] || 0) + 1;
		if (r.examples.length < 5) r.examples.push({ path: owner, property });
		assets.set(id, r);
	};
	for (const r of rows) {
		const p = r.properties,
			service = r.path.split("/")[0].replace(/\[\d+\]$/, "");
		if (r.className === "Workspace")
			for (const [k, v] of Object.entries(p))
				if (/Streaming|StreamOut|Replication/.test(k)) workspaceSettings[k] = v;
		if (r.className === "MeshPart")
			for (const [k, v] of [
				["collision", p.CollisionFidelity],
				["render", p.RenderFidelity],
			])
				fidelity[k][v ?? "unspecified"] = (fidelity[k][v ?? "unspecified"] || 0) + 1;
		classes[r.className] = (classes[r.className] || 0) + 1;
		const s = (services[service] ||= {
			instances: 0,
			baseParts: 0,
			meshParts: 0,
			scriptSourceBytes: 0,
			serializedClientCandidate: CLIENT.has(service),
		});
		s.instances++;
		if (BASE.has(r.className)) s.baseParts++;
		if (r.className === "MeshPart") s.meshParts++;
		const group = r.path.split("/").slice(0, 3).join("/");
		const g = (groups[group] ||= { instances: 0, baseParts: 0, meshParts: 0 });
		g.instances++;
		if (BASE.has(r.className)) g.baseParts++;
		if (r.className === "MeshPart") g.meshParts++;
		if (BASE.has(r.className)) {
			physics.baseParts++;
			if (service === "Workspace") {
				physics.workspaceBaseParts++;
				for (const flag of partFlags) {
					if (p[flag] === undefined)
						physics.missingExplicitFlags[flag] = (physics.missingExplicitFlags[flag] || 0) + 1;
					else if (flag === "Anchored" && p[flag] === "false") physics.workspaceUnanchored++;
					else if (flag !== "Anchored" && p[flag] === "true") physics["workspace" + flag]++;
				}
			}
		}
		const contentKeys = new Set();
		for (const a of r.assets) {
			addAsset(a.value, r.path, a.property, "property");
			contentKeys.add(a.property);
		}
		for (const [k, v] of Object.entries(p))
			if (!contentKeys.has(k) && /Mesh|Texture|Image|SoundId|AnimationId/.test(k))
				addAsset(v, r.path, k, "property");
		if (r.source !== undefined) {
			s.scriptSourceBytes += Buffer.byteLength(r.source);
			const indicators = [];
			for (const [index, line] of r.source.split("\n").entries())
				if (/RenderStepped|Heartbeat|PreloadAsync|GetDescendants\(|FireAllClients|while true/.test(line))
					indicators.push({ line: index + 1, text: line.trim().slice(0, 220) });
			scripts.push({
				path: r.path,
				className: r.className,
				bytes: Buffer.byteLength(r.source),
				sha256: sha(r.source),
				indicators,
			});
			for (const m of r.source.matchAll(
				/rbxassetid:\/\/\d+|https?:\/\/(?:www\.)?roblox\.com\/asset\/?\?id=\d+/g,
			))
				addAsset(m[0], r.path, "Source", "source");
		}
	}
	let knownMeshInstanceTriangles = 0,
		coveredMeshInstances = 0,
		conflictingTriangleReceipts = 0;
	for (const a of assets.values()) {
		a.receipts = receiptRows.filter((r) => r.assetId === a.id);
		const totals = [
			...new Set(
				a.receipts
					.filter((r) => r.geometryHashMatched === true && r.triangles !== null)
					.map((r) => r.triangles),
			),
		];
		a.localVerifiedInputTriangles = totals.length === 1 ? totals[0] : null;
		if (totals.length > 1) conflictingTriangleReceipts++;
		const references = (a.properties.MeshContent || 0) + (a.properties.MeshId || 0);
		if (a.localVerifiedInputTriangles !== null) {
			knownMeshInstanceTriangles += references * a.localVerifiedInputTriangles;
			coveredMeshInstances += references;
		}
	}
	return {
		instances: rows.length,
		classes,
		services,
		physics,
		workspaceSettings,
		fidelity,
		largestGroups: Object.entries(groups)
			.map(([path, value]) => ({ path, ...value }))
			.sort((a, b) => b.baseParts - a.baseParts)
			.slice(0, 40),
		assets: [...assets.values()].sort(
			(a, b) => b.propertyReferences - a.propertyReferences || a.id.localeCompare(b.id),
		),
		scripts,
		geometry: {
			knownMeshInstanceTriangles,
			coveredMeshInstances,
			totalMeshParts: classes.MeshPart || 0,
			conflictingTriangleReceipts,
			meaning:
				"Sum of receipt-reported triangles per serialized mesh reference, only for hash-matched local .mesh.json inputs; not native rendered triangles, runtime clones, LOD, or physics hulls.",
		},
	};
}
function generatedSources(root) {
	const mapping = path.join(root, "default.project.json");
	if (!fs.existsSync(mapping)) return [];
	const result = [];
	const visitFiles = (directory, instance) => {
		if (!fs.existsSync(directory)) throw Error("Mapped generated sources missing; build first: " + directory);
		for (const name of fs.readdirSync(directory).sort()) {
			const full = path.join(directory, name);
			if (fs.lstatSync(full).isSymbolicLink()) throw Error("Mapped source symlink refused");
			if (fs.statSync(full).isDirectory()) visitFiles(full, instance + "." + name);
			else if (/\.lua[u]?$/.test(name) && !/\.spec\.lua[u]?$/.test(name)) {
				const stem = name.replace(/\.lua[u]?$/, "");
				const className = /\.server$/.test(stem)
					? "Script"
					: /\.client$/.test(stem)
						? "LocalScript"
						: "ModuleScript";
				const object = stem.replace(/\.(server|client)$/, "");
				result.push({ file: full, path: object === "init" ? instance : instance + "." + object, className });
			}
		}
	};
	const visitMapping = (node, instance) => {
		// Only the template's generated TypeScript roots. Packages/native assets are inventory-only.
		if (typeof node.$path === "string" && /^out[\\/]/.test(node.$path)) {
			const full = path.resolve(root, node.$path);
			const relative = path.relative(root, full);
			if (relative.startsWith("..") || path.isAbsolute(relative))
				throw Error("Mapped source escapes checkout");
			visitFiles(full, instance);
		}
		for (const [name, child] of Object.entries(node))
			if (!name.startsWith("$") && child && typeof child === "object")
				visitMapping(child, instance ? instance + "." + name : name);
	};
	visitMapping(JSON.parse(readText(mapping)).tree, "");
	return result;
}
function compareSources(root, rows) {
	const index = new Map();
	for (const row of rows) {
		const name = row.path.replace(/\[\d+\]/g, "").replaceAll("/", ".");
		const list = index.get(name) || [];
		list.push(row);
		index.set(name, list);
	}
	const mismatches = [],
		matched = [];
	for (const file of files(path.join(root, "studio")).filter((f) => f.endsWith(".luau"))) {
		let relative = path
			.relative(path.join(root, "studio"), file)
			.replaceAll("\\", "/")
			.replace(/\.(server|client)?\.?luau$/, "");
		relative = relative
			.replace(/^StarterPlayerScripts\//, "StarterPlayer/StarterPlayerScripts/")
			.replace(/^StarterCharacterScripts\//, "StarterPlayer/StarterCharacterScripts/");
		const name = relative.replaceAll("/", ".");
		const found = index.get(name) || [];
		const source = normalize(readText(file));
		const expectedClass = file.endsWith(".server.luau")
			? "Script"
			: file.endsWith(".client.luau")
				? "LocalScript"
				: "ModuleScript";
		const row = { file: path.relative(root, file).replaceAll("\\", "/"), sha256: sha(source), path: name };
		if (found.length !== 1 || found[0].source !== source || found[0].className !== expectedClass)
			mismatches.push({
				...row,
				candidates: found.length,
				buildSha256: found[0]?.source === undefined ? null : sha(found[0].source),
			});
		else matched.push(row);
	}
	for (const entry of generatedSources(root)) {
		const found = index.get(entry.path) || [],
			source = normalize(readText(entry.file));
		const row = {
			file: path.relative(root, entry.file).replaceAll("\\", "/"),
			path: entry.path,
			sha256: sha(source),
		};
		if (found.length !== 1 || found[0].source !== source || found[0].className !== entry.className)
			mismatches.push({
				...row,
				candidates: found.length,
				buildSha256: found[0]?.source === undefined ? null : sha(found[0].source),
			});
		else matched.push(row);
	}
	return {
		scope:
			"Native studio/*.luau convention and generated out/ directory mappings in default.project.json, excluding specs. Does not prove TypeScript was freshly compiled; run verify first. Package/model/nested-project mappings are inventory-only.",
		matched,
		mismatches,
	};
}
function audit({ root, place, python = process.platform === "win32" ? "python" : "python3" }) {
	root = path.resolve(root);
	place = path.resolve(place);
	const before = snapshot(root),
		assetBefore = receipts(root),
		placeSha256 = sha(fs.readFileSync(place));
	const rows = parsePlace(place, python),
		result = inventory(rows, assetBefore),
		sourceInclusion = compareSources(root, rows);
	const after = snapshot(root),
		assetAfter = receipts(root);
	if (
		digest(before) !== digest(after) ||
		digest(assetBefore) !== digest(assetAfter) ||
		placeSha256 !== sha(fs.readFileSync(place))
	)
		throw Error("Audit inputs changed during read; no stable report produced");
	return {
		version: 1,
		evidence:
			"Offline static inventory; no native timing, hosted permission, streaming/runtime population, or physical-device acceptance.",
		root,
		place,
		provenance: {
			head: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: root,
				encoding: "utf8",
				windowsHide: true,
			}).trim(),
			dirty: execFileSync("git", ["status", "--short", "--untracked-files=all"], {
				cwd: root,
				encoding: "utf8",
				windowsHide: true,
			}),
			sourceSha256: digest(before),
			sourceFiles: before,
			receiptSetSha256: digest(assetBefore),
			placeSha256,
			auditScriptSha256: sha(fs.readFileSync(__filename)),
		},
		sourceInclusion,
		...result,
		limitations: [
			"Class allowlist counts ordinary BaseParts; unknown future BasePart subclasses are not inferred.",
			"Absent physics flags are counted as unknown; engine defaults are not guessed.",
			"Client candidate is a service classification, not measured network payload; runtime clones and streaming change populations.",
			"IDs in Source are literal candidates; comments and inactive paths can be counted; dynamic IDs may be absent.",
			"Receipt cloudLoad is historical local evidence, not a current hosted permission check.",
			"Generated source comparison uses current compiled files; it does not prove those files match current TypeScript. Run npm run verify first.",
			"Image dimensions/texture memory and engine mesh LOD/collision geometry cannot be established from XML alone.",
		],
	};
}
function main(argv) {
	if (argv.includes("--help"))
		return console.log(
			"Offline asset inventory: npm run audit:assets -- [--place build/game.rbxlx] [--out build/release-audit/report.json] [--python python]. Requires Python 3; no Studio or cloud access.",
		);
	const options = {
		root: ROOT,
		place: path.join(ROOT, "build/game.rbxlx"),
		out: path.join(ROOT, "build/release-audit/report.json"),
	};
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i]?.slice(2);
		if (!["root", "place", "out", "python"].includes(flag) || !argv[i + 1])
			throw Error("Use --root <source> --place <rbxlx> --out <json> [--python <executable>]");
		options[flag] = argv[i + 1];
	}
	const out = path.resolve(options.out),
		allowed = path.join(ROOT, "build/release-audit") + path.sep;
	if (!out.startsWith(allowed)) throw Error("Report output must be under this checkout build/release-audit");
	// Refuse a junction in an existing output ancestor before creating directories.
	for (let ancestor = out; ancestor !== ROOT; ancestor = path.dirname(ancestor)) {
		if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink())
			throw Error("Report output must be under the real checkout directory; symlink/junction refused");
	}
	const report = audit(options);
	fs.mkdirSync(path.dirname(out), { recursive: true });
	fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
	console.log(
		JSON.stringify({
			out,
			instances: report.instances,
			assets: report.assets.length,
			sourceMismatches: report.sourceInclusion.mismatches.length,
			placeSha256: report.provenance.placeSha256,
		}),
	);
	if (report.sourceInclusion.mismatches.length) process.exitCode = 2;
}
module.exports = { parsePlace, assetId, inventory, receipts, compareSources, audit, main };
if (require.main === module)
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
