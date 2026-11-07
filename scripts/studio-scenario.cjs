#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readText, readJson } = require("./text-files.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { lifecycle, verifyOwnership } = require("./studio-native-play.cjs");
const { run: input, prepare } = require("./studio-actions.cjs");
const { decodeResult } = require("./studio-author.cjs");
const device = require("./studio-device.cjs");
const { schemas } = require("./studio-schemas.cjs");
async function scenario(client, studio, document, options) {
	if (
		document.version !== 1 ||
		typeof document.name !== "string" ||
		!Array.isArray(document.steps) ||
		document.steps.length < 1 ||
		document.steps.length > 30
	)
		throw Error("Scenario needs version:1, name, and 1..30 steps.");
	if (document.device !== undefined) device.validateDevice(document.device);
	const available = await schemas(client);
	const steps = document.steps.map((step) => {
		if (step.kind === "probe") {
			if (!["Client", "Server"].includes(step.context) || typeof step.file !== "string")
				throw Error("Probe needs Client/Server context and a Luau file.");
			const code = readText(path.resolve(options.base, step.file));
			if (!code.trim()) throw Error("Probe file is empty.");
			return { ...step, code };
		}
		if (step.kind === "screenshot" && !options.outputDir)
			throw Error("Scenario screenshots require outputDir before starting a test.");
		prepare({ version: 1, steps: [step] }, available, studio.id);
		return step;
	});
	const report = {
		name: document.name,
		studio,
		startedAt: new Date().toISOString(),
		passed: false,
		steps: [],
	};
	let started = false,
		priorDevice;
	const inputState = {};
	try {
		if (document.device) {
			priorDevice = await device.snapshot(client, studio);
			report.deviceBefore = priorDevice;
			report.device = await device.configure(client, studio, document.device);
		}
		await lifecycle(client, studio, "start", options.session);
		started = true;
		for (const step of steps) {
			if (step.kind === "probe") {
				await verifyOwnership(client, studio, options.session);
				const code =
					"local function check()\n" +
					step.code +
					'\nend\nlocal value=check()\nassert(type(value)=="table" and type(value.passed)=="boolean","Probe must return {passed=boolean,...}")\nreturn game:GetService("HttpService"):JSONEncode({robloxStudio=1,ok=true,value=value})';
				const value = decodeResult(
					await client.call("execute_luau", { studio_id: studio.id, datamodel_type: step.context, code }),
				).value;
				report.steps.push({ kind: "probe", file: step.file, context: step.context, result: value });
				if (!value.passed) throw Error(`Probe failed: ${step.file}`);
			} else
				report.steps.push(
					await input(
						client,
						studio,
						{ version: 1, steps: [step] },
						{
							session: options.session,
							outputDir: options.outputDir,
							imagePrefix: `scenario-${report.steps.length + 1}`,
							inputState,
						},
					),
				);
		}
		report.passed = true;
	} catch (error) {
		report.error = error.message;
	} finally {
		await require("./studio-guard.cjs").withCleanup(async () => {
			if (started) {
				try {
					report.cleanup = await lifecycle(client, studio, "stop", options.session);
				} catch (error) {
					report.passed = false;
					report.cleanupError = error.message;
				}
			}
			if (priorDevice) {
				try {
					report.deviceRestored = await device.restore(client, studio, priorDevice);
				} catch (error) {
					report.passed = false;
					report.restoreError = error.message;
				}
			}
		});
		report.finishedAt = new Date().toISOString();
		report.bridgeTimings = client.timingSummary?.();
	}
	return report;
}
async function main(argv = process.argv.slice(2)) {
	if (argv.length === 0 || argv.includes("--help"))
		return process.stdout.write(
			"Owned MCP-only test scenarios\nnode scripts/studio-scenario.cjs scenario.json --out build/playtests/report.json\nStarts its own test, executes game input, native screenshots and assertion probes, then stops its own test even on failure. Images use a unique directory per run.\n",
		);
	if (argv.length !== 3 || argv[1] !== "--out") throw Error("Use <scenario.json> --out <report.json>.");
	const file = path.resolve(argv[0]),
		out = path.resolve(argv[2]);
	if (file === out) throw Error("Report must not overwrite the scenario.");
	const client = new McpClient(findBridge(), ["--stdio"], 60000);
	try {
		await client.connect();
		const studio = chooseStudio(
			await client.call("list_roblox_studios"),
			undefined,
			require("./studio-config.cjs").read().expectedPlaceId,
		);
		const runId = crypto.randomUUID();
		const report = await scenario(client, studio, readJson(file), {
			base: path.dirname(file),
			session: path.join(path.dirname(out), runId + ".session.json"),
			outputDir: path.join(path.dirname(out), runId + "-images"),
		});
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, JSON.stringify(report, null, 2));
		process.stdout.write(JSON.stringify(report, null, 2) + "\n");
		if (!report.passed) process.exitCode = 1;
	} finally {
		client.close();
	}
}
if (require.main === module)
	main().catch((error) => {
		console.error(JSON.stringify({ error: error.message }));
		process.exitCode = 1;
	});
module.exports = { scenario, main };
