import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { root, toolPath } from "./lib.mjs";

const expectedNode = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
let failed = false;
function check(ok, message) {
	console.log(`${ok ? "OK" : "FAIL"}: ${message}`);
	failed ||= !ok;
}
check(process.versions.node === expectedNode, `Node ${expectedNode} (found ${process.versions.node})`);
const packageData = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const currentNpm = process.env.npm_config_user_agent?.match(/npm\/(\S+)/)?.[1];
check(
	currentNpm === packageData.engines.npm,
	`npm ${packageData.engines.npm} (found ${currentNpm ?? "run through npm run doctor"})`,
);
const rokit = spawnSync(toolPath("rokit"), ["--version"], { cwd: root, encoding: "utf8" });
check(
	rokit.status === 0 && rokit.stdout?.includes("1.2.0"),
	"Rokit 1.2.0 (see README installation instructions)",
);
const manifest = readFileSync(new URL("../rokit.toml", import.meta.url), "utf8");
for (const name of ["rojo", "lune"]) {
	const expected = manifest.match(new RegExp(`${name} = ".*@([^"]+)"`))?.[1];
	const result = spawnSync(toolPath(name), ["--version"], { cwd: root, encoding: "utf8" });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
	check(
		result.status === 0 && output.includes(expected),
		`${name} ${expected}: ${output || "missing; run rokit install"}`,
	);
}
process.exitCode = failed ? 1 : 0;
