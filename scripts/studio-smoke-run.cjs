// Internal turn command: never starts a test in an unverified editor.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { decodeResult } = require("./studio-result.cjs");
const { scenario } = require("./studio-scenario.cjs");
const ROOT = path.resolve(__dirname, "..");

async function runSmoke(client, studio, manifest, options, runScenario = scenario) {
	const observed = decodeResult(
		await client.call("execute_luau", {
			studio_id: studio.id,
			datamodel_type: "Edit",
			code: 'local s=game.ServerScriptService:FindFirstChild("SmokeTest");return game.HttpService:JSONEncode({robloxStudio=1,ok=true,digest=s and s:GetAttribute("TemplateSmokeDigest") or ""})',
		}),
	);
	if (observed.digest !== manifest.digest)
		throw Error(
			"Selected Studio is not the current smoke build. Open build/smoke.rbxlx; do not run against another place.",
		);
	return runScenario(
		client,
		studio,
		JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "smoke.scenario.json"))),
		options,
	);
}

async function main() {
	const ctx = require("./studio-guard.cjs").assert(ROOT);
	const client = new McpClient(findBridge(), ["--stdio"], 60000);
	const directory = path.join(ROOT, "build", "studio-smoke");
	const runtimeReport = path.resolve(process.argv[2] || path.join(directory, "runtime.json"));
	if (!runtimeReport.startsWith(directory + path.sep))
		throw Error("Runtime report must stay under build/studio-smoke.");
	const evidenceDirectory = path.dirname(runtimeReport);
	let report = { passed: false };
	try {
		await client.connect();
		const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json")));
		const studio = require("./studio.cjs").chooseStudio(
			await client.call("list_roblox_studios"),
			ctx.studioId,
		);
		const runId = randomUUID();
		report = await runSmoke(client, studio, manifest, {
			base: path.join(ROOT, "tests"),
			session: path.join(evidenceDirectory, runId + ".session.json"),
			outputDir: path.join(evidenceDirectory, runId + "-images"),
		});
		report.source = manifest;
		report.console = await client.call("get_console_output", { studio_id: studio.id });
	} catch (error) {
		report.passed = false;
		report.error = error.message;
	} finally {
		fs.mkdirSync(evidenceDirectory, { recursive: true });
		fs.writeFileSync(runtimeReport, JSON.stringify(report, null, 2));
		client.close();
	}
	if (!report.passed) throw Error(report.error || "Smoke scenario failed");
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = { runSmoke };
