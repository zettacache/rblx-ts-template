import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function sourceSnapshot(root) {
	const files = require("./tooling-snapshot.cjs").snapshot(root);
	function visit(relative) {
		const absolute = path.join(root, relative);
		if (!fs.existsSync(absolute)) return;
		const stat = fs.lstatSync(absolute);
		if (stat.isSymbolicLink()) throw Error(`Snapshot refuses symlink: ${relative}`);
		if (stat.isDirectory())
			for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
		else if (stat.isFile())
			files[relative.replaceAll("\\", "/")] = createHash("sha256")
				.update(fs.readFileSync(absolute))
				.digest("hex");
	}
	for (const item of [
		"tests",
		".github",
		"test.project.json",
		"rokit.toml",
		".node-version",
		".nvmrc",
		"eslint.config.mjs",
		".prettierignore",
		".prettierrc.json",
	])
		visit(item);
	const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
	return {
		algorithm: "sha256",
		digest: createHash("sha256").update(JSON.stringify(ordered)).digest("hex"),
		files: ordered,
	};
}

export function execute(command, args, { cwd, log }) {
	return new Promise((resolve) => {
		const output = fs.createWriteStream(log);
		let logError;
		output.on("error", (error) => {
			logError = error.message;
		});
		const child = spawn(command, args, {
			cwd,
			shell: false,
			windowsHide: true,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		for (const [stream, destination] of [
			[child.stdout, process.stdout],
			[child.stderr, process.stderr],
		])
			stream.on("data", (data) => {
				output.write(data);
				destination.write(data);
			});
		let spawnError;
		child.on("error", (error) => {
			spawnError = error.message;
		});
		child.on("close", (code, signal) =>
			output.end(() =>
				resolve({
					exitCode: code,
					signal,
					error: spawnError ?? logError,
					passed: code === 0 && !spawnError && !logError,
				}),
			),
		);
	});
}

export function writeJson(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
