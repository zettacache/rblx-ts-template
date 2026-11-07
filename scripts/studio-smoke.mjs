import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { root, toolPath } from "./lib.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execute, sourceSnapshot, writeJson } from "./verification-core.mjs";
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const automated = args.includes("--automated");
const noBuild = args.includes("--no-build");
const studioIndex = args.indexOf("--studio");
const studio = studioIndex >= 0 ? args[studioIndex + 1] : undefined;
const known = new Set(["--automated", "--no-build", "--build-only", "--studio"]);
for (let i = 0; i < args.length; i++) {
	if (!known.has(args[i])) throw Error(`Unknown option: ${args[i]}`);
	if (args[i] === "--studio") i++;
}
if ((automated && !studio) || (noBuild && !automated) || (automated && args.includes("--build-only")))
	throw Error("Use --automated --studio <id> [--no-build], --build-only, or no options.");
const directory = path.join(root, "build", "studio-smoke");
mkdirSync(directory, { recursive: true });
const acceptanceDirectory = path.join(directory, randomUUID());
if (automated) mkdirSync(acceptanceDirectory, { recursive: true });
const automatedReport = {
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	passed: false,
	status: "failed",
	studio,
	runtimeReport: path.join(acceptanceDirectory, "runtime.json"),
	reportFile: path.join(acceptanceDirectory, "report.json"),
};
async function checked(command, commandArgs, name) {
	const result = await execute(command, commandArgs, { cwd: root, log: path.join(directory, name + ".log") });
	if (!result.passed) throw Error(result.error ?? `${name} failed (${result.exitCode ?? result.signal})`);
}

async function build() {
	await checked(process.execPath, [process.env.npm_execpath, "run", "build"], "compile");
	const source = sourceSnapshot(root);
	const project = JSON.parse(readFileSync(path.join(root, "default.project.json"), "utf8"));
	project.name = "template-smoke-test";
	delete project.servePlaceIds;
	project.tree.ReplicatedStorage.SmokeResult = { $className: "RemoteEvent" };
	project.tree.ServerScriptService.SmokeTest = {
		$path: "tests/studio.server.luau",
		$attributes: { TemplateSmokeDigest: source.digest },
	};
	project.tree.StarterPlayer.StarterPlayerScripts.SmokeTest = { $path: "tests/studio.client.luau" };
	writeFileSync(path.join(root, "smoke.project.json"), `${JSON.stringify(project, null, 2)}\n`);
	mkdirSync(path.join(root, "build"), { recursive: true });
	await checked(toolPath("rojo"), ["build", "smoke.project.json", "--output", "build/smoke.rbxlx"], "rojo");
	writeJson(path.join(directory, "manifest.json"), {
		schemaVersion: 1,
		runId: randomUUID(),
		digest: source.digest,
		builtAt: new Date().toISOString(),
	});
}

async function main() {
	if (!noBuild) await build();
	if (automated) {
		const report = automatedReport;
		try {
			const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json")));
			if (manifest.digest !== sourceSnapshot(root).digest)
				throw Error("Smoke build is stale; rebuild before automated acceptance.");
			report.source = manifest;
			// Check discovery/configuration before acquiring a resource that would need recovery.
			const expected = require("./studio-config.cjs").read().expectedPlaceId;
			if (expected === null || expected === undefined)
				throw Error("Configure studio-tools.json expectedPlaceId for the dedicated smoke place first.");
			const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
			const discovery = new McpClient(findBridge(), ["--stdio"], 30000);
			try {
				await discovery.connect();
				const selected = require("./studio.cjs").chooseStudio(
					await discovery.call("list_roblox_studios"),
					studio,
					expected,
				);
				if (
					String(selected.placeId) !== String(expected) &&
					!new RegExp(`placeId:\\s*${expected}\\b`).test(selected.name || "") &&
					!(String(expected) === "0" && /\.rbxlx?$/i.test(selected.name || ""))
				)
					throw Error("Selected Studio does not match configured smoke place.");
			} finally {
				discovery.close();
			}
			const plan = path.join(acceptanceDirectory, "turn.json");
			writeJson(plan, {
				operation: "template-smoke",
				command: ["node", "scripts/studio-smoke-run.cjs", report.runtimeReport],
				cleanupProbe: "../../../tests/smoke-cleanup.luau",
			});
			const options = { studio, request: randomUUID(), owner: "template-smoke", task: manifest.runId };
			const turn = require("./studio-turn.cjs");
			await turn.run(plan, { ...options, action: "request" });
			report.turn = await turn.run(plan, { ...options, action: "run" });
			report.runtime = JSON.parse(readFileSync(report.runtimeReport));
			if (manifest.digest !== sourceSnapshot(root).digest)
				throw Error("Source changed during native acceptance; rerun the final smoke build.");
			report.passed = report.runtime.passed === true && report.turn.released === true;
			report.status = report.passed ? "passed" : "failed";
		} catch (error) {
			report.error = error.message;
			if (error.evidence) report.turn = { evidence: error.evidence, released: error.released === true };
		} finally {
			report.finishedAt = new Date().toISOString();
			writeJson(path.join(directory, "report.json"), report);
			writeJson(report.reportFile, report);
		}
		if (!report.passed) throw Error(report.error ?? "Studio smoke failed");
		return;
	}
	if (!args.includes("--build-only")) {
		const place = path.join(root, "build", "smoke.rbxlx");
		let command;
		let args;
		if (process.platform === "win32") {
			const directories = [process.env.LOCALAPPDATA, path.join(homedir(), "AppData", "Local")]
				.filter(Boolean)
				.map((directory) => path.join(directory, "Roblox", "Versions"))
				.filter(existsSync);
			command =
				process.env.ROBLOX_STUDIO_PATH ||
				[
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
		const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
		child.on("error", (error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
		child.unref();
		console.log(
			"Press Play in the dedicated smoke place. Output must show [Smoke] PASS. Stop Play afterward.",
		);
	}
}
await main().catch((error) => {
	if (automated) {
		const failed = {
			...automatedReport,
			passed: false,
			status: "failed",
			error: error.message,
			finishedAt: new Date().toISOString(),
		};
		writeJson(path.join(directory, "report.json"), failed);
		writeJson(failed.reportFile, failed);
	}
	console.error(error.message);
	process.exitCode = 1;
});
