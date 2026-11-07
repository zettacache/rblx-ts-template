import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export function assertBuildCleanable(buildDirectory) {
	function visit(directory) {
		if (!existsSync(directory)) return;
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Inspect recovery symlink before cleaning: ${file}`);
			if (entry.isDirectory()) {
				if (directory === buildDirectory && ["blender", "blender-batches", "test-temp"].includes(entry.name))
					continue;
				visit(file);
			} else if (entry.isFile() && entry.name.endsWith(".json")) {
				let record;
				try {
					record = JSON.parse(readFileSync(file, "utf8"));
				} catch (cause) {
					throw new Error(`Unreadable recovery record; inspect before cleaning: ${file}`, { cause });
				}
				if (
					(record.token && record.released !== true && record.status !== "stopped") ||
					["sending", "processing", "unconfirmed", "pending", "starting", "running"].includes(
						record.status,
					) ||
					(record.status === "applied" && record.review)
				) {
					throw new Error(
						`Unresolved Studio/upload evidence must be recovered or archived before cleaning: ${file}`,
					);
				}
			}
		}
	}
	visit(buildDirectory);
}
