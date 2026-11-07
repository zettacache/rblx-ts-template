// Source identity for reviewed turns. Explicit scopes are opt-in; the historical
// full-source fingerprint stays byte-for-byte compatible with queued requests.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const PINNED_FILES = [
	"default.project.json",
	"test.project.json",
	"studio-tools.json",
	"package.json",
	"package-lock.json",
	"tsconfig.json",
];
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function validateSourceFiles(sourceFiles, sourceStable) {
	if (sourceFiles === undefined) return;
	if (sourceStable === false)
		throw Error("sourceFiles requires sourceStable; sourceStable:false cannot use a source scope.");
	if (!Array.isArray(sourceFiles) || sourceFiles.length === 0)
		throw Error("sourceFiles must be a nonempty array of exact repository-relative files.");
	const seen = new Set();
	for (const file of sourceFiles) {
		if (
			typeof file !== "string" ||
			!file ||
			file !== file.trim() ||
			path.posix.isAbsolute(file) ||
			path.win32.isAbsolute(file) ||
			/[:*?[\]{}]/.test(file) ||
			[...file].some((character) => character.charCodeAt(0) < 32)
		)
			throw Error(
				"sourceFiles accepts exact repository-relative filenames only; no globs or absolute paths.",
			);
		const normalized = file.replaceAll("\\", "/");
		if (normalized.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)))
			throw Error("sourceFiles traversal or ambiguous path refused.");
		const key = normalized.toLowerCase();
		if (seen.has(key)) throw Error("sourceFiles contains duplicate filenames.");
		seen.add(key);
	}
}

function scopedSnapshot(root, sourceFiles) {
	validateSourceFiles(sourceFiles);
	const realRoot = fs.realpathSync(root);
	const declared = sourceFiles.map((file) => file.replaceAll("\\", "/"));
	// Explicitly declaring a pinned mapping is valid, but hash it only once.
	const files = [...declared];
	for (const file of PINNED_FILES)
		if (!files.some((value) => value.toLowerCase() === file.toLowerCase())) files.push(file);
	const targets = new Set();
	return Object.fromEntries(
		files.sort().map((file) => {
			const full = path.resolve(root, file);
			let real;
			try {
				if (!fs.lstatSync(full).isFile()) throw Error("not a regular file");
				real = fs.realpathSync(full);
				const relative = path.relative(realRoot, real);
				if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
					throw Error("symlink or junction escape");
				if (targets.has(process.platform === "win32" ? real.toLowerCase() : real))
					throw Error("duplicate file target");
				targets.add(process.platform === "win32" ? real.toLowerCase() : real);
			} catch (error) {
				throw Error(
					`Scoped source file ${file} is missing, unsafe, or not a regular file: ${error.message}`,
					{ cause: error },
				);
			}
			return [file, hash(fs.readFileSync(full))];
		}),
	);
}

function sourceEvidence(root, plan = {}) {
	validateSourceFiles(plan.sourceFiles, plan.sourceStable);
	const scoped = plan.sourceFiles !== undefined;
	const files = scoped
		? scopedSnapshot(root, plan.sourceFiles)
		: require("./tooling-snapshot.cjs").snapshot(root);
	return { mode: scoped ? "explicit-files" : "full", files, version: hash(JSON.stringify(files)) };
}

module.exports = { PINNED_FILES, validateSourceFiles, scopedSnapshot, sourceEvidence };
