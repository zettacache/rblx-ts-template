import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function toolPath(name) {
	const executable = process.platform === "win32" ? `${name}.exe` : name;
	return (
		[path.join(root, ".tools", executable), path.join(homedir(), ".rokit", "bin", executable)].find(
			existsSync,
		) ?? name
	);
}

export function run(command, args = []) {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.error)
		throw new Error(`Could not start ${command}. Run rokit install and npm ci.`, { cause: result.error });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

export function tool(name, args = []) {
	run(toolPath(name), args);
}
