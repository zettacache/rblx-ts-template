import path from "node:path";
import fs from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { root } from "./lib.mjs";
import { execute, sourceSnapshot, writeJson } from "./verification-core.mjs";

export async function verify(options = {}) {
	const directory = options.root ?? root;
	const runId = randomUUID();
	const output = path.join(directory, "build", "verification", runId);
	fs.mkdirSync(output, { recursive: true });
	const reportFile = path.join(output, "report.json");
	const report = {
		schemaVersion: 1,
		runId,
		scope: options.studio ? "offline-and-studio" : "offline",
		startedAt: new Date().toISOString(),
		status: "running",
		passed: false,
		checks: [],
		studio: {
			status: "not_run",
			reason: "Use --studio <id> with a configured target and the current smoke place open.",
		},
		artifacts: [],
	};
	const run = options.execute ?? execute;
	const snapshot = options.snapshot ?? sourceSnapshot;
	const tasks = [
		["doctor", ["run", "doctor"]],
		["check", ["run", "check"]],
		["tooling", ["run", "test:tooling"]],
		["runtime", ["test"]],
		["production-place", ["run", "build:place"]],
		["smoke-build", ["run", "test:studio", "--", "--build-only"]],
	];
	if (options.studio)
		tasks.push([
			"studio",
			["run", "test:studio", "--", "--automated", "--no-build", "--studio", options.studio],
		]);
	try {
		report.source = snapshot(directory);
		writeJson(reportFile, report);
		let failed = false;
		for (const [name, args] of tasks) {
			if (failed) {
				report.checks.push({ name, status: "skipped", reason: "Earlier check failed" });
				continue;
			}
			const log = path.join(output, `${name}.log`);
			const startedAt = new Date().toISOString();
			const command = [process.execPath, process.env.npm_execpath, ...args];
			if (!command[1]) throw Error("Run through npm run verify so npm_execpath is available.");
			const result = await run(command[0], command.slice(1), { cwd: directory, log });
			const check = {
				name,
				command,
				startedAt,
				finishedAt: new Date().toISOString(),
				...result,
				log,
				status: result.passed ? "passed" : "failed",
			};
			report.checks.push(check);
			failed = !result.passed;
			if (name === "studio")
				report.studio = {
					status: check.status,
					report: path.join(output, "studio.json"),
				};
			if (name === "studio") {
				let accepted = false;
				const latest = path.join(directory, "build", "studio-smoke", "report.json");
				if (fs.existsSync(latest)) {
					const smoke = JSON.parse(fs.readFileSync(latest));
					if (
						Date.parse(smoke.startedAt) >= Date.parse(startedAt) &&
						smoke.studio === options.studio &&
						smoke.source?.digest === report.source.digest
					) {
						fs.copyFileSync(latest, report.studio.report);
						accepted = smoke.passed === true;
					} else {
						delete report.studio.report;
						report.studio.reason = "No matching smoke report for this verification attempt";
					}
				} else {
					delete report.studio.report;
					report.studio.reason = "Smoke command did not produce a report";
				}
				if (result.passed && !accepted) {
					check.passed = false;
					check.status = "failed";
					report.studio.status = "failed";
					failed = true;
				}
			}
			writeJson(reportFile, report);
		}
		if (
			options.studio &&
			!report.checks.some((check) => check.name === "studio" && check.status !== "skipped")
		)
			report.studio = { status: "not_run", reason: "Earlier check failed" };
		report.sourceStable = report.source.digest === snapshot(directory).digest;
		report.passed = !failed && report.sourceStable;
		report.status = report.passed ? "passed" : "failed";
		if (!report.sourceStable)
			report.error = "Source changed during verification; rerun for the final snapshot.";
		for (const [check, file] of [
			["production-place", "build/game.rbxlx"],
			["runtime", "build/tests.rbxl"],
			["smoke-build", "build/smoke.rbxlx"],
		]) {
			const absolute = path.join(directory, file);
			if (
				report.checks.some((item) => item.name === check && item.status === "passed") &&
				fs.existsSync(absolute)
			)
				report.artifacts.push({
					path: absolute,
					sha256: createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"),
					check,
				});
		}
	} catch (error) {
		report.passed = false;
		report.status = "failed";
		report.error = error.message;
	} finally {
		report.finishedAt = new Date().toISOString();
		writeJson(reportFile, report);
		writeJson(path.join(directory, "build", "verification", "latest.json"), { ...report, reportFile });
	}
	return { ...report, reportFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.includes("--help"))
		console.log(
			"npm run verify [-- --studio <id>]\nRuns doctor, checks, tooling/runtime tests and both place builds. Studio is explicitly not run unless requested. Reports: build/verification/<run-id>/report.json and latest.json.",
		);
	else {
		if (args.length && (args.length !== 2 || args[0] !== "--studio" || !args[1]))
			throw Error("Use --studio <id> or no options.");
		const report = await verify({ studio: args[1] });
		console.log(
			JSON.stringify({ status: report.status, studio: report.studio.status, report: report.reportFile }),
		);
		process.exitCode = report.passed ? 0 : 1;
	}
}
