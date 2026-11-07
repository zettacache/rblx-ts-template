#!/usr/bin/env node
// Headless Blender jobs. Python inputs are trusted local code, not a sandbox.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const cache = require("./blender-cache.cjs");
const ROOT = path.resolve(__dirname, "..");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const pipelineIdentity = {
	runnerSha256: sha(fs.readFileSync(__filename)),
	cacheSha256: sha(fs.readFileSync(require.resolve("./blender-cache.cjs"))),
	animationValidatorSha256: sha(fs.readFileSync(require.resolve("./studio-animation.cjs"))),
	textReaderSha256: sha(fs.readFileSync(require.resolve("./text-files.cjs"))),
	atomicReplaceSha256: sha(fs.readFileSync(require.resolve("./atomic-replace.cjs"))),
};
function discover(env = process.env) {
	if (env.BLENDER_EXE) {
		const exe = path.resolve(env.BLENDER_EXE);
		if (!fs.existsSync(exe)) throw Error("BLENDER_EXE does not exist.");
		return exe;
	}
	const bases = [
		path.join(env.ProgramFiles || "C:/Program Files", "Blender Foundation"),
		path.join(env.LOCALAPPDATA || "", "Programs", "Blender Foundation"),
	];
	const candidates = [];
	for (const base of bases)
		if (fs.existsSync(base))
			for (const entry of fs.readdirSync(base)) {
				const exe = path.join(base, entry, "blender.exe");
				if (fs.existsSync(exe)) candidates.push(exe);
			}
	if (candidates.length)
		return candidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
	const found = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["blender"], {
		encoding: "utf8",
		windowsHide: true,
	});
	if (found.status === 0) return found.stdout.trim().split(/\r?\n/)[0];
	throw Error("Blender was not found. Set BLENDER_EXE to an installed executable.");
}
function validate(doc, base) {
	if (doc.version !== 1 || typeof doc.name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(doc.name))
		throw Error("Job requires version:1 and a simple name.");
	if (!doc.script && !doc.blend) throw Error("Supply script and/or blend input.");
	const result = { ...doc };
	for (const key of ["script", "blend"])
		if (doc[key]) {
			if (typeof doc[key] !== "string") throw Error(`Invalid ${key} path.`);
			result[key] = path.resolve(base, doc[key]);
			if (!fs.statSync(result[key]).isFile()) throw Error(`Missing ${key} input.`);
			if (!result[key].toLowerCase().endsWith(key === "script" ? ".py" : ".blend"))
				throw Error(`Invalid ${key} extension.`);
		}
	result.formats = doc.formats ?? ["glb", "fbx"];
	if (
		!Array.isArray(result.formats) ||
		!result.formats.length ||
		new Set(result.formats).size !== result.formats.length ||
		result.formats.some((x) => !["glb", "fbx"].includes(x))
	)
		throw Error("formats must contain glb and/or fbx.");
	result.views = doc.views ?? ["front", "back", "iso"];
	if (
		!Array.isArray(result.views) ||
		result.views.length > 6 ||
		new Set(result.views).size !== result.views.length ||
		result.views.some((x) => !["front", "back", "left", "right", "top", "iso"].includes(x))
	)
		throw Error("Invalid render views.");
	result.size = doc.size ?? 512;
	if (!Number.isInteger(result.size) || result.size < 128 || result.size > 1024)
		throw Error("Render size must be 128..1024.");
	result.dependencies = doc.dependencies ?? [];
	if (!Array.isArray(result.dependencies) || result.dependencies.some((p) => typeof p !== "string" || !p))
		throw Error("dependencies must be file paths.");
	result.dependencies = result.dependencies.map((p) => path.resolve(base, p));
	for (const p of result.dependencies) if (!fs.statSync(p).isFile()) throw Error("Missing dependency: " + p);
	if (doc.animation) {
		const a = doc.animation;
		if (
			typeof a.armature !== "string" ||
			!a.armature ||
			typeof a.rootPart !== "string" ||
			!a.rootPart ||
			!Number.isInteger(a.start) ||
			!Number.isInteger(a.end) ||
			a.end <= a.start ||
			a.end - a.start > 1800 ||
			!Number.isInteger(a.fps) ||
			a.fps < 1 ||
			a.fps > 60 ||
			(a.end - a.start) / a.fps > 60 ||
			(a.loop !== undefined && typeof a.loop !== "boolean") ||
			(a.studsPerUnit !== undefined && (!(a.studsPerUnit > 0) || !Number.isFinite(a.studsPerUnit)))
		)
			throw Error(
				"Animation needs armature, rootPart, start/end (max 1800 frames/60 seconds), fps (1..60), optional positive studsPerUnit.",
			);
	}
	return result;
}
function launch(exe, args, log, timeoutMs = 300000) {
	return new Promise((resolve, reject) => {
		const stream = fs.createWriteStream(log, { flags: "wx" });
		const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		child.stdout.pipe(stream, { end: false });
		child.stderr.pipe(stream, { end: false });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		child.once("error", (err) => {
			clearTimeout(timer);
			stream.end();
			reject(err);
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			stream.end(() =>
				code === 0 && !timedOut
					? resolve()
					: reject(Error(`Blender ${timedOut ? "timed out" : `exited ${code}`}; see ${log}`)),
			);
		});
	});
}
function profile(job, name = "full") {
	if (!["full", "preview"].includes(name)) throw Error("Profile must be full or preview.");
	return {
		...job,
		reviewProfile: name,
		renderSamples: name === "preview" ? 8 : 24,
		size: name === "preview" ? Math.min(job.size, 256) : job.size,
	};
}
function executableIdentity(executable) {
	const version = spawnSync(executable, ["--background", "--version"], {
		encoding: "utf8",
		windowsHide: true,
		timeout: 15000,
	});
	if (version.status !== 0) throw Error("Blender version probe failed.");
	return { path: executable, version: version.stdout.trim(), sha256: sha(fs.readFileSync(executable)) };
}
async function run(file, options = {}, runtime = {}) {
	const started = performance.now();
	const job = profile(
		validate(require("./text-files.cjs").readJson(file), path.dirname(path.resolve(file))),
		options.profile,
	);
	const executable = runtime.executable || discover();
	const identity = (runtime.executableIdentity || executableIdentity)(executable);
	const root = runtime.root || path.join(ROOT, "build", "blender");
	const output = path.join(root, job.name + "-" + randomUUID());
	fs.mkdirSync(output, { recursive: true });
	const worker = path.join(__dirname, "blender", "worker.py");
	const workerBytes = fs.readFileSync(worker),
		workerSha256 = sha(workerBytes);
	const sourceBytes = Object.fromEntries(
		["script", "blend"].filter((k) => job[k]).map((k) => [k, fs.readFileSync(job[k])]),
	);
	const dependencies = Object.fromEntries(job.dependencies.map((p) => [p, sha(fs.readFileSync(p))]));
	const key = sha(
		JSON.stringify({
			job,
			inputs: Object.fromEntries(Object.entries(sourceBytes).map(([k, b]) => [k, sha(b)])),
			dependencies,
			identity,
			workerSha256,
			...pipelineIdentity,
		}),
	);
	if (options.reuse) {
		const cached = cache.reuse(root, key, output);
		if (cached) {
			const copiedJob = JSON.parse(fs.readFileSync(path.join(output, "job.json")));
			for (const field of ["script", "blend"])
				if (copiedJob[field])
					copiedJob[field] = path.join(output, field === "script" ? "source.py" : "input.blend");
			fs.writeFileSync(path.join(output, "job.json"), JSON.stringify(copiedJob, null, 2));
			const manifest = {
				...cached,
				cache: { ...cached.cache, artifacts: cache.inventory(output) },
				timings: { totalMs: performance.now() - started },
				buildTimings: cached.buildTimings || cached.timings,
			};
			fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
			return { output, ...manifest };
		}
	}
	// Freeze inputs before executing so the manifest describes the job that ran.
	const inputs = {};
	for (const key of ["script", "blend"])
		if (job[key]) {
			const bytes = sourceBytes[key];
			inputs[key] = { source: job[key], sha256: sha(bytes) };
			job[key] = path.join(output, key === "script" ? "source.py" : "input.blend");
			fs.writeFileSync(job[key], bytes);
		}
	const frozen = path.join(output, "job.json");
	fs.writeFileSync(frozen, JSON.stringify(job, null, 2));
	const frozenWorker = path.join(output, "worker.py");
	fs.writeFileSync(frozenWorker, workerBytes);
	const args = [
		"--background",
		"--factory-startup",
		"--disable-autoexec",
		"--python-exit-code",
		"1",
		"--python",
		frozenWorker,
		"--",
		frozen,
		output,
	];
	const launchStarted = performance.now();
	await (runtime.launch || launch)(executable, args, path.join(output, "blender.log"));
	const blenderMs = performance.now() - launchStarted;
	for (const [p, hash] of Object.entries(dependencies))
		if (sha(fs.readFileSync(p)) !== hash) throw Error("Dependency changed during Blender run: " + p);
	const report = JSON.parse(fs.readFileSync(path.join(output, "report.json")));
	if (report.ok !== true) throw Error("Blender did not report success.");
	// Keep the existing promoted-artifact contract; cache inventory also covers
	// recipe outputs and frozen inputs, which promotion scripts need not copy.
	const artifacts = {};
	for (const name of [
		"scene.blend",
		...job.formats.map((x) => `model.${x}`),
		...job.views.map((x) => `${x}.png`),
		...(job.animation ? ["animation.json", ...[0, 1, 2, 3].map((i) => `motion-${i}.png`)] : []),
	]) {
		const bytes = fs.readFileSync(path.join(output, name));
		if (!bytes.length) throw Error(`Empty Blender artifact: ${name}`);
		artifacts[name] = { bytes: bytes.length, sha256: sha(bytes) };
	}
	if (job.animation)
		require("./studio-animation.cjs").validate(
			JSON.parse(fs.readFileSync(path.join(output, "animation.json"))),
		);
	const manifest = {
		version: 1,
		executable,
		executableIdentity: identity,
		inputs,
		dependencies,
		workerSha256,
		artifacts,
		report,
		reviewProfile: job.reviewProfile,
		cache: { key, reused: false, artifacts: cache.inventory(output) },
		timings: { blenderMs, totalMs: performance.now() - started },
	};
	cache.publish(root, key, output, manifest);
	return { output, ...manifest };
}
async function main(argv = process.argv.slice(2)) {
	if (!argv.length || argv[0] === "--help")
		return console.log(
			"blender.cjs doctor | run <job.json> [--profile full|preview] [--reuse]\n--reuse asserts deterministic inputs; declare external files in job.dependencies. Outputs are copied into fresh build/blender folders. Preview is iteration evidence only.",
		);
	if (argv[0] === "doctor" && argv.length === 1) {
		const executable = discover(),
			version = spawnSync(executable, ["--background", "--version"], {
				encoding: "utf8",
				windowsHide: true,
				timeout: 15000,
			});
		if (version.status !== 0) throw Error("Blender version probe failed.");
		return console.log(JSON.stringify({ executable, version: version.stdout.trim() }, null, 2));
	}
	if (argv[0] !== "run" || !argv[1]) throw Error("Use doctor or run <job.json>.");
	const options = {};
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--reuse" && !options.reuse) options.reuse = true;
		else if (argv[i] === "--profile" && !options.profile && ["full", "preview"].includes(argv[i + 1]))
			options.profile = argv[++i];
		else throw Error("Unknown or repeated Blender option: " + argv[i]);
	}
	console.log(JSON.stringify(await run(argv[1], options), null, 2));
}
if (require.main === module)
	main().catch((e) => {
		console.error(JSON.stringify({ error: e.message }));
		process.exitCode = 1;
	});
module.exports = { discover, validate, launch, run, sha, profile, executableIdentity };
