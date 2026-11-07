#!/usr/bin/env node
// Ready verification only: one FIFO admission, sequential checked steps, no
// authoring, cached passes, automatic retries, shell commands or test discovery.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { readPlan, sourceVersion, registerProcess, finishProcess } = require("./studio-turn.cjs");
const ROOT = path.resolve(__dirname, "..");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

function input(root, filename) {
	const absolute = path.resolve(filename);
	const relative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
	assert(
		relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative),
		"Batch input escapes checkout",
	);
	assert(fs.lstatSync(absolute).isFile(), "Batch inputs must be regular files");
	return { file: absolute, sha256: sha(fs.readFileSync(absolute)) };
}

function prepare(manifestFile, output, options = {}) {
	const root = options.root || ROOT;
	const manifest = read(manifestFile);
	const base = path.dirname(path.resolve(manifestFile));
	assert(
		manifest.version === 1 && typeof manifest.operation === "string" && manifest.operation.trim(),
		"Invalid batch header",
	);
	assert(
		Array.isArray(manifest.steps) && manifest.steps.length > 0 && manifest.steps.length <= 6,
		"Choose one to six ready verification steps",
	);
	const maxDurationMs = manifest.maxDurationMs ?? 600000;
	assert(
		Number.isInteger(maxDurationMs) && maxDurationMs >= 1000 && maxDurationMs <= 600000,
		"Batch soft budget must be 1–600 seconds",
	);
	const names = manifest.steps.map((step) => step.name);
	assert(
		names.every((name) => typeof name === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(name)) &&
			new Set(names).size === names.length,
		"Invalid or duplicate step name",
	);
	const selected = options.only || names;
	assert(
		selected.length &&
			new Set(selected).size === selected.length &&
			selected.every((name) => names.includes(name)),
		"Unknown or duplicate selected step",
	);
	assert(
		manifest.inputs === undefined ||
			(Array.isArray(manifest.inputs) && manifest.inputs.every((value) => typeof value === "string")),
		"Batch inputs must be explicit filenames",
	);
	const toolFiles = [
		"studio-verify-batch.cjs",
		"studio-verification-gate.cjs",
		"studio-turn.cjs",
		"studio-turn-source.cjs",
		"studio-guard.cjs",
		"studio-device.cjs",
		"studio-state.cjs",
		"studio-result.cjs",
		"studio-mcp-client.cjs",
		"tooling-snapshot.cjs",
		"path-identity.cjs",
		"studio-config.cjs",
	];
	const pins = [
		input(root, manifestFile),
		...toolFiles.map((file) => input(root, path.join(__dirname, file))),
	];
	for (const filename of manifest.inputs || []) pins.push(input(root, path.resolve(base, filename)));
	const steps = manifest.steps
		.filter((step) => selected.includes(step.name))
		.map((step) => {
			const file = path.resolve(base, step.plan);
			const plan = readPlan(file);
			assert(plan.sourceStable !== false, "Author/import plans cannot run inside a verification batch");
			assert(
				plan.command[0] === "node" && /\.(cjs|js)$/.test(plan.command[1] || ""),
				"Batch fixtures must use an explicit Node entrypoint",
			);
			assert(
				!["studio-turn.cjs", path.basename(__filename)].includes(path.basename(plan.command[1])),
				"Nested reservations/batches are not supported",
			);
			assert(
				["edit-engine", "native-client", "native-visual", "offline"].includes(step.evidence),
				"Declare each step evidence level",
			);
			const args = step.args === undefined ? plan.command.slice(2) : step.args;
			assert(
				Array.isArray(args) && args.every((value) => typeof value === "string"),
				"Step args must be a string array",
			);
			pins.push(
				input(root, file),
				input(root, plan.cleanupProbe),
				input(root, path.resolve(root, plan.command[1])),
			);
			return {
				name: step.name,
				planFile: file,
				planDigest: plan.digest,
				command: plan.command.slice(0, 2).concat(args),
				evidence: step.evidence,
				sourceFiles: plan.sourceFiles,
				cleanupProbe: plan.cleanupProbe,
				cleanupSource: plan.cleanupSource,
			};
		});
	assert(
		steps.every((step) => step.cleanupSource === steps[0].cleanupSource),
		"Batch steps must share the same reviewed cleanup contract",
	);
	const target = path.resolve(output);
	const targetRelative = path.relative(path.resolve(root), target);
	assert(
		targetRelative &&
			targetRelative !== ".." &&
			!targetRelative.startsWith(".." + path.sep) &&
			!path.isAbsolute(targetRelative),
		"Batch output must stay inside checkout",
	);
	let ancestor = target;
	while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
	const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(ancestor));
	assert(
		realRelative !== ".." && !realRelative.startsWith(".." + path.sep) && !path.isAbsolute(realRelative),
		"Batch output escapes through a junction",
	);
	assert(!fs.existsSync(target), "Use a fresh batch output directory");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.mkdirSync(target);
	for (const step of steps)
		step.command = step.command.map((value) => value.replaceAll("${OUTPUT}", target.replaceAll("\\", "/")));
	const descriptor = {
		version: 1,
		root: path.resolve(root),
		operation: manifest.operation,
		maxDurationMs,
		steps,
		omitted: names.filter((name) => !selected.includes(name)),
		inputs: [...new Map(pins.map((pin) => [pin.file, pin])).values()],
	};
	const descriptorFile = path.join(target, "batch.json");
	write(descriptorFile, { ...descriptor, digest: sha(JSON.stringify(descriptor)) });
	const turn = {
		operation: manifest.operation,
		command: ["node", "scripts/studio-verify-batch.cjs", "run", descriptorFile],
		cleanupProbe: steps[0].cleanupProbe,
		sourceStable: true,
	};
	if (steps.every((step) => step.sourceFiles)) {
		const scope = steps
			.flatMap((step) => step.sourceFiles)
			.concat(
				descriptor.inputs.map((pin) => path.relative(root, pin.file)),
				path.relative(root, descriptorFile),
			);
		turn.sourceFiles = [
			...new Map(
				scope.map((file) => {
					const normalized = file.replaceAll("\\", "/");
					return [normalized.toLowerCase(), normalized];
				}),
			).values(),
		].sort();
	}
	const turnFile = path.join(target, "turn.json");
	write(turnFile, turn);
	return {
		turn: turnFile,
		batch: descriptorFile,
		selected: steps.map((step) => step.name),
		omitted: descriptor.omitted,
	};
}

function validatePrepared(file, root) {
	input(root, file);
	const { digest, ...batch } = read(file);
	assert(
		batch.version === 1 && batch.root === path.resolve(root) && sha(JSON.stringify(batch)) === digest,
		"Batch receipt changed or belongs to another checkout",
	);
	for (const pin of batch.inputs)
		assert.equal(input(root, pin.file).sha256, pin.sha256, "Prepared input changed: " + pin.file);
	for (const step of batch.steps)
		assert.equal(readPlan(step.planFile).digest, step.planDigest, "Reviewed step plan changed");
	return batch;
}

function executeStep(command, output, processApi, options = {}) {
	return new Promise((resolve, reject) => {
		const descriptor = fs.openSync(output + ".log", "wx");
		const gate = output + ".gate.json";
		const id = crypto.randomUUID();
		const gateTemporary = gate + "." + id + ".tmp";
		let child, managed, launchError;
		try {
			child = spawn(
				process.execPath,
				["--require", path.join(__dirname, "studio-verification-gate.cjs"), ...command.slice(1)],
				{
					cwd: options.root || ROOT,
					windowsHide: true,
					shell: false,
					stdio: ["ignore", descriptor, descriptor],
					env: {
						...process.env,
						STUDIO_VERIFICATION_GATE: gate,
						STUDIO_VERIFICATION_GATE_ID: id,
						STUDIO_VERIFICATION_GATE_TIMEOUT_MS: String(options.gateTimeoutMs || 10000),
					},
				},
			);
			if (child.pid) {
				try {
					managed = processApi.register(child.pid, path.basename(output));
					fs.writeFileSync(gateTemporary, JSON.stringify({ id }), { flag: "wx" });
					fs.renameSync(gateTemporary, gate);
				} catch (error) {
					launchError = error; /* Gate stays shut; wait for confirmed child exit. */
				}
			}
			child.once("error", (error) => {
				launchError = error;
			});
			child.once("close", (code, signal) => {
				fs.closeSync(descriptor);
				if (fs.existsSync(gate)) fs.unlinkSync(gate);
				if (fs.existsSync(gateTemporary)) fs.unlinkSync(gateTemporary);
				try {
					if (managed) processApi.finish(managed, { exitCode: code, signal });
					if (launchError) reject(launchError);
					else
						resolve({ exitCode: code, signal, log: output + ".log", commandPassed: code === 0 && !signal });
				} catch (error) {
					reject(error);
				}
			});
		} catch (error) {
			fs.closeSync(descriptor);
			reject(error);
		}
	});
}

async function run(file, runtime = {}) {
	const root = runtime.root || ROOT;
	const batch = validatePrepared(file, root);
	const ctx = runtime.assertOwnership
		? runtime.assertOwnership()
		: require("./studio-guard.cjs").assert(root);
	const record = runtime.record || read(process.env.STUDIO_TURN_RECORD);
	assert(
		["token", "owner", "task", "studioId", "projectId"].every((key) => record[key] === ctx[key]) &&
			require("./path-identity.cjs").samePath(record.checkout, root),
		"Batch turn record identity mismatch",
	);
	const report = {
		operation: batch.operation,
		commandPassed: false,
		steps: [],
		omitted: batch.omitted,
		evidenceScope: "Command execution and native cleanup only; original captures still require visual review",
		startedAt: new Date().toISOString(),
	};
	const directory = path.dirname(file);
	const reportFile = path.join(directory, "report.json");
	assert(!fs.existsSync(reportFile), "Batch already ran; prepare a fresh receipt");
	fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
	const save = () => write(reportFile, report);
	const started = performance.now();
	const versions = batch.steps.map((step) => sourceVersion(root, step));
	let client;
	let afterStep = runtime.afterStep;
	try {
		if (!afterStep) {
			const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
			const { decodeResult } = require("./studio-result.cjs");
			const { mode } = require("./studio-state.cjs");
			const device = require("./studio-device.cjs");
			client = new McpClient(findBridge(), ["--stdio"], 30000);
			await client.connect();
			afterStep = async (step) => {
				assert.equal(
					mode(await client.call("get_studio_state", { studio_id: ctx.studioId })),
					"Edit",
					"Fixture left a running test",
				);
				assert.deepEqual(
					await device.snapshot(client, { id: ctx.studioId }),
					record.device,
					"Fixture left changed device settings",
				);
				const result = decodeResult(
					await client.call("execute_luau", {
						studio_id: ctx.studioId,
						datamodel_type: "Edit",
						code: step.cleanupSource,
					}),
				);
				assert.equal(result.clean, true, "Fixture cleanup probe failed");
			};
		}
		for (const [index, step] of batch.steps.entries()) {
			validatePrepared(file, root);
			assert.equal(sourceVersion(root, step), versions[index], "Source changed before verification step");
			assert(
				performance.now() - started < batch.maxDurationMs,
				"Batch soft budget exhausted; remaining checks were not started",
			);
			const stepStarted = performance.now();
			const result = await executeStep(
				step.command,
				path.join(directory, step.name),
				runtime.processApi || { register: registerProcess, finish: finishProcess },
				{ root, gateTimeoutMs: runtime.gateTimeoutMs },
			);
			const entry = {
				name: step.name,
				evidence: step.evidence,
				...result,
				elapsedMs: performance.now() - stepStarted,
				cleanupPassed: false,
			};
			report.steps.push(entry);
			save();
			// A failed command never causes an automatic retry or starts later checks.
			assert(result.commandPassed, "Verification command failed: " + step.name);
			await afterStep(step);
			validatePrepared(file, root);
			assert.equal(sourceVersion(root, step), versions[index], "Source changed during verification step");
			entry.cleanupPassed = true;
			save();
			(runtime.progress || console.log)(
				JSON.stringify({
					step: step.name,
					commandPassed: true,
					cleanupPassed: true,
					elapsedMs: entry.elapsedMs,
					log: entry.log,
				}),
			);
		}
		report.commandPassed = true;
	} catch (error) {
		report.error = error.message;
	} finally {
		if (client) client.close();
		report.notRun = batch.steps.slice(report.steps.length).map((step) => step.name);
		report.elapsedMs = performance.now() - started;
		report.finishedAt = new Date().toISOString();
		save();
	}
	return { ...report, report: reportFile };
}

async function main(argv = process.argv.slice(2)) {
	const [action, file, ...args] = argv;
	if (!action || action === "--help")
		return console.log(
			"studio-verify-batch prepare <manifest.json> --out <fresh-directory> [--only name,name]\nstudio-verify-batch run <prepared-batch.json> (inside its studio-turn only)",
		);
	if (action === "prepare") {
		assert(
			args[0] === "--out" && args[1] && (args.length === 2 || (args.length === 4 && args[2] === "--only")),
			"Invalid prepare options",
		);
		console.log(
			JSON.stringify(prepare(path.resolve(file), path.resolve(args[1]), { only: args[3]?.split(",") })),
		);
	} else {
		assert(action === "run" && args.length === 0, "Invalid batch command");
		const result = await run(path.resolve(file));
		console.log(
			JSON.stringify({
				commandPassed: result.commandPassed,
				steps: result.steps.length,
				omitted: result.omitted,
				elapsedMs: result.elapsedMs,
				report: result.report,
				error: result.error,
			}),
		);
		if (!result.commandPassed) process.exitCode = 1;
	}
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = { prepare, validatePrepared, executeStep, run, main };
