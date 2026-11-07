import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertBuildCleanable } from "../recovery-files.mjs";

test("clean preserves unresolved receipts, turns and authored-state journals", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "recovery-evidence-"));
	try {
		mkdirSync(path.join(directory, "turns"));
		const file = path.join(directory, "turns", "record.json");
		for (const record of [
			{ token: "fixture" },
			{ status: "unconfirmed" },
			{ status: "applied", review: {} },
		]) {
			writeFileSync(file, JSON.stringify(record));
			assert.throws(() => assertBuildCleanable(directory), /before cleaning/);
		}
		writeFileSync(file, JSON.stringify({ token: "fixture", released: true }));
		assert.doesNotThrow(() => assertBuildCleanable(directory));
		writeFileSync(file, "truncated");
		assert.throws(() => assertBuildCleanable(directory), /Unreadable recovery record/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
