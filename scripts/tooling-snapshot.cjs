const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
function snapshot(root) {
	const result = {};
	function visit(relative) {
		const file = path.join(root, relative);
		if (!fs.existsSync(file)) return;
		const stat = fs.lstatSync(file);
		if (stat.isSymbolicLink()) throw Error("Source snapshot refuses symlinks: " + relative);
		if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
		else if (stat.isFile())
			result[relative.replaceAll("\\", "/")] = createHash("sha256")
				.update(fs.readFileSync(file))
				.digest("hex");
	}
	for (const item of [
		"src",
		"studio",
		"scripts",
		"assets",
		"default.project.json",
		"studio.project.json",
		"studio-tools.json",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
	])
		visit(item);
	return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
module.exports = { snapshot };
