import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { root, run, tool } from "./lib.mjs";

run(process.execPath, [process.env.npm_execpath, "run", "build"]);
const project = JSON.parse(readFileSync(path.join(root, "default.project.json"), "utf8"));
project.name = "template-smoke-test";
delete project.servePlaceIds;
project.tree.ReplicatedStorage.SmokeResult = { $className: "RemoteEvent" };
project.tree.ServerScriptService.SmokeTest = { $path: "tests/studio.server.luau" };
project.tree.StarterPlayer.StarterPlayerScripts.SmokeTest = { $path: "tests/studio.client.luau" };
writeFileSync(path.join(root, "smoke.project.json"), `${JSON.stringify(project, null, 2)}\n`);
mkdirSync(path.join(root, "build"), { recursive: true });
tool("rojo", ["build", "smoke.project.json", "--output", "build/smoke.rbxlx"]);
if (!process.argv.includes("--build-only")) {
	const place = path.join(root, "build", "smoke.rbxlx");
	let command;
	let args;
	if (process.platform === "win32") {
		const directories = [process.env.LOCALAPPDATA, path.join(homedir(), "AppData", "Local")]
			.filter(Boolean)
			.map((directory) => path.join(directory, "Roblox", "Versions"))
			.filter(existsSync);
		command = [
			process.env.ROBLOX_STUDIO_PATH,
			...directories.flatMap((versions) =>
				readdirSync(versions).map((version) => path.join(versions, version, "RobloxStudioBeta.exe")),
			),
		]
			.filter(Boolean)
			.filter((file) => {
				try {
					return statSync(file).isFile();
				} catch {
					return false;
				}
			})
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
		if (!command) throw new Error("Roblox Studio was not found. Open build/smoke.rbxlx manually.");
		args = [place];
	} else if (process.platform === "darwin") {
		command = "open";
		args = ["-a", "RobloxStudio", place];
	} else throw new Error("Studio requires Windows or macOS. The smoke place has been built.");
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", (error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
	child.unref();
	console.log("Press Play in the dedicated smoke place. Output must show [Smoke] PASS. Stop Play afterward.");
}
