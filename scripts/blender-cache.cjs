// Disposable, content-addressed reuse for explicitly deterministic Blender jobs.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function inventory(root, relative = "") {
	const result = {};
	for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
		const name = path.posix.join(relative, entry.name);
		if (entry.isSymbolicLink()) throw Error("Blender artifacts cannot contain symbolic links: " + name);
		if (entry.isDirectory()) Object.assign(result, inventory(root, name));
		else if (entry.isFile() && !["manifest.json", "blender.log"].includes(name)) {
			const bytes = fs.readFileSync(path.join(root, name));
			result[name] = { bytes: bytes.length, sha256: sha(bytes) };
		}
	}
	return result;
}
function inside(root, file) {
	const relative = path.relative(root, file);
	return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function reuse(root, key, output) {
	try {
		const pointer = JSON.parse(fs.readFileSync(path.join(root, ".cache", key + ".json")));
		const source = path.resolve(root, pointer.directory);
		if (!inside(root, source) || fs.lstatSync(source).isSymbolicLink()) return null;
		const bytes = fs.readFileSync(path.join(source, "manifest.json"));
		if (sha(bytes) !== pointer.manifestSha256) return null;
		const manifest = JSON.parse(bytes);
		if (manifest.cache?.key !== key || manifest.report?.ok !== true) return null;
		const actual = inventory(source);
		if (JSON.stringify(actual) !== JSON.stringify(manifest.cache.artifacts)) return null;
		// Copy verified bytes, never hard-link editable artifacts to the cache source.
		for (const [name, expected] of Object.entries(actual)) {
			const data = fs.readFileSync(path.join(source, name));
			if (sha(data) !== expected.sha256) throw Error("Cached artifact changed during copy");
			fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
			fs.writeFileSync(path.join(output, name), data, { flag: "wx" });
		}
		return { ...manifest, cache: { key, reused: true, source, artifacts: actual } };
	} catch (error) {
		// A partially copied output must not be used as a fresh build directory.
		if (fs.readdirSync(output).length) throw error;
		return null;
	}
}
function publish(root, key, output, manifest) {
	const bytes = JSON.stringify(manifest, null, 2);
	fs.writeFileSync(path.join(output, "manifest.json"), bytes, { flag: "wx" });
	const dir = path.join(root, ".cache");
	fs.mkdirSync(dir, { recursive: true });
	const temporary = path.join(dir, key + "-" + randomUUID() + ".tmp");
	fs.writeFileSync(
		temporary,
		JSON.stringify({ directory: path.relative(root, output), manifestSha256: sha(bytes) }),
		{ flag: "wx" },
	);
	require("./atomic-replace.cjs").atomicReplace(temporary, path.join(dir, key + ".json"));
}
module.exports = { inventory, reuse, publish, sha };
