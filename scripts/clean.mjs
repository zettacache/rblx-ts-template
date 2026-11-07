import { rmSync } from "node:fs";
import path from "node:path";
import { root } from "./lib.mjs";
import { assertBuildCleanable } from "./recovery-files.mjs";

assertBuildCleanable(path.join(root, "build"));

// Fixed generated targets only. Never accept deletion paths from CLI input.
for (const name of ["out", "include", "build", "flamework.build", "smoke.project.json"]) {
	const target = path.resolve(root, name);
	if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Unsafe clean target");
	rmSync(target, { recursive: true, force: true });
}
