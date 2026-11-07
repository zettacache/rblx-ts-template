const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { availableParallelism } = require("node:os");
const blender = require("./blender.cjs");
const { readJson } = require("./text-files.cjs");

async function batch(file, options = {}, runtime = {}) {
	const manifest = readJson(file),
		base = path.dirname(path.resolve(file));
	if (
		manifest.version !== 1 ||
		!Array.isArray(manifest.jobs) ||
		manifest.jobs.length < 1 ||
		manifest.jobs.length > 100 ||
		manifest.jobs.some((job) => typeof job !== "string" || !job)
	)
		throw Error("Batch requires version:1 and 1..100 job paths.");
	const jobs = manifest.jobs.map((job) => path.resolve(base, job));
	if (new Set(jobs).size !== jobs.length) throw Error("Duplicate batch job path.");
	const concurrency = options.jobs ?? 1;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
		throw Error("--jobs must be 1..4.");
	if (
		options.threads !== undefined &&
		options.threads !== "auto" &&
		(!Number.isInteger(options.threads) || options.threads < 1 || options.threads > 256)
	)
		throw Error("--threads must be 1..256.");
	if (options.persistentData !== undefined && typeof options.persistentData !== "boolean")
		throw Error("persistentData must be boolean.");
	const cpuCount = (runtime.cpuCount || availableParallelism)();
	const workerCount = Math.min(concurrency, jobs.length);
	const threadBudget = Math.min(256, Math.max(1, Math.floor(cpuCount / workerCount)));
	const jobConfigs = jobs.map((job) =>
		blender.profile(blender.validate(readJson(job), path.dirname(job)), options.profile),
	);
	const threadsPerJob = jobConfigs.map((job) =>
		options.threads === "auto" ? (job.renderThreads ?? threadBudget) : (options.threads ?? job.renderThreads),
	);
	const started = performance.now();
	// One expensive binary hash/version probe per batch; each job still hashes its inputs and verifies outputs.
	const executable = runtime.executable || blender.discover();
	const identity = (runtime.executableIdentity || blender.executableIdentity)(executable);
	const run = runtime.run || blender.run;
	const results = new Array(jobs.length);
	let cursor = 0;
	async function worker() {
		while (cursor < jobs.length) {
			const index = cursor++,
				job = jobs[index],
				jobStarted = performance.now();
			try {
				const result = await run(
					job,
					{
						profile: options.profile,
						reuse: options.reuse,
						persistentData: options.persistentData,
						threads: threadsPerJob[index],
					},
					{ ...runtime, executable, executableIdentity: () => identity },
				);
				results[index] = {
					job,
					ok: true,
					output: result.output,
					reused: result.cache.reused,
					elapsedMs: performance.now() - jobStarted,
				};
			} catch (error) {
				results[index] = { job, ok: false, error: error.message, elapsedMs: performance.now() - jobStarted };
			}
		}
	}
	await Promise.all(Array.from({ length: workerCount }, worker));
	const report = {
		version: 1,
		ok: results.every((result) => result.ok),
		concurrency,
		workerCount,
		cpuCount,
		threadsPerJob: threadsPerJob.map((threads) => threads ?? null),
		executableIdentity: identity,
		elapsedMs: performance.now() - started,
		results,
	};
	const directory = runtime.reportRoot || path.resolve(__dirname, "..", "build", "blender-batches");
	fs.mkdirSync(directory, { recursive: true });
	const reportFile = path.join(directory, randomUUID() + ".json");
	fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: "wx" });
	return { ...report, reportFile };
}
async function main(argv = process.argv.slice(2)) {
	if (!argv.length || argv.includes("--help"))
		return console.log(
			"blender-batch.cjs <batch.json> [--profile full|preview] [--reuse] [--jobs 1..4] [--threads auto|1..256] [--no-persistent-data]\nDefaults: full, one worker, automatic render threading, no cache reuse. --threads auto divides a CPU thread budget across workers. All jobs are preflighted; one report records every result.",
		);
	const options = {};
	for (let i = 1; i < argv.length; i++) {
		if (argv[i] === "--reuse" && options.reuse === undefined) options.reuse = true;
		else if (argv[i] === "--threads" && options.threads === undefined && argv[i + 1])
			options.threads = argv[i + 1] === "auto" ? argv[++i] : Number(argv[++i]);
		else if (argv[i] === "--no-persistent-data" && options.persistentData === undefined)
			options.persistentData = false;
		else if (
			argv[i] === "--profile" &&
			options.profile === undefined &&
			["full", "preview"].includes(argv[i + 1])
		)
			options.profile = argv[++i];
		else if (argv[i] === "--jobs" && options.jobs === undefined && argv[i + 1])
			options.jobs = Number(argv[++i]);
		else throw Error("Invalid or repeated batch option: " + argv[i]);
	}
	const result = await batch(argv[0], options);
	console.log(JSON.stringify(result, null, 2));
	if (!result.ok) process.exitCode = 1;
}
if (require.main === module)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
module.exports = { batch, main };
