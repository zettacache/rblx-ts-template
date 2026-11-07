import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root } from "./lib.mjs";

// Workspace scratch avoids Windows sandbox redirection of %TEMP% and keeps cleanup local.
const temporary = path.join(root, "build", "test-temp");
mkdirSync(temporary, { recursive: true });
const tests = readdirSync(path.join(root, "scripts"))
	.filter((name) => /^test-.*\.cjs$/.test(name))
	.sort();
const result = spawnSync(
	process.execPath,
	["--test", ...tests.map((name) => path.join(root, "scripts", name))],
	{
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
	},
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
