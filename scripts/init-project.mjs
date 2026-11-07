import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./lib.mjs";

export function initializeProject(directory, name, placeId) {
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name ?? "")) {
		throw new Error("Use a lowercase project name, e.g. my-roblox-game.");
	}
	if (
		placeId !== undefined &&
		(!/^\d+$/.test(placeId) || !Number.isSafeInteger(Number(placeId)) || Number(placeId) <= 0)
	) {
		throw new Error("Place ID must be a positive safe integer.");
	}
	const packagePath = path.join(directory, "package.json");
	const lockPath = path.join(directory, "package-lock.json");
	const projectPath = path.join(directory, "default.project.json");
	const studioToolsPath = path.join(directory, "studio-tools.json");
	const studioTools = JSON.parse(readFileSync(studioToolsPath, "utf8"));
	const packageData = JSON.parse(readFileSync(packagePath, "utf8"));
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	const project = JSON.parse(readFileSync(projectPath, "utf8"));
	const readmePath = path.join(directory, "README.md");
	const readme = readFileSync(readmePath, "utf8");
	packageData.name = name;
	packageData.description = `${name}: a Roblox game built with roblox-ts, Jecs, and Flamework networking.`;
	lock.name = name;
	lock.packages[""].name = name;
	project.name = name;
	if (placeId !== undefined) {
		project.servePlaceIds = [Number(placeId)];
		studioTools.expectedPlaceId = String(placeId);
	}
	for (const [file, data] of [
		[packagePath, packageData],
		[lockPath, lock],
		[projectPath, project],
		[studioToolsPath, studioTools],
	]) {
		writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
	}
	writeFileSync(readmePath, readme.replace(/^# .*$/m, `# ${name}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, "scripts", "init-project.mjs")) {
	const [name, ...options] = process.argv.slice(2);
	const validOptions = options.length === 0 || (options.length === 2 && options[0] === "--place-id");
	if (!validOptions) throw new Error("Usage: npm run init:project -- my-game [--place-id 123]");
	initializeProject(root, name, options[1]);
	console.log(`Initialized ${name}. Run npm run clean, then npm run check.`);
}
