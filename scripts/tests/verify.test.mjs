import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { verify } from "../verify.mjs";
import { sourceSnapshot } from "../verification-core.mjs";

function setup(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-verify-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}
test("offline passes explicitly exclude Studio and retain per-check evidence", async (t) => {
	const root = setup(t);
	const report = await verify({
		root,
		snapshot: () => ({ digest: "stable" }),
		execute: async () => ({ passed: true, exitCode: 0 }),
	});
	assert.equal(report.passed, true);
	assert.equal(report.studio.status, "not_run");
	assert.equal(report.checks.length, 6);
	assert.equal(JSON.parse(fs.readFileSync(report.reportFile)).sourceStable, true);
});
test("failures skip dependent work and overwrite latest without inheriting a prior pass", async (t) => {
	const root = setup(t);
	const options = {
		root,
		snapshot: () => ({ digest: "stable" }),
		execute: async () => ({ passed: true, exitCode: 0 }),
	};
	await verify(options);
	const report = await verify({
		...options,
		studio: "fake-test-only",
		execute: async () => ({ passed: false, exitCode: 3 }),
	});
	assert.equal(report.passed, false);
	assert.equal(report.checks[0].exitCode, 3);
	assert.equal(report.checks[1].status, "skipped");
	assert.equal(report.studio.status, "not_run");
	assert.equal(JSON.parse(fs.readFileSync(path.join(root, "build/verification/latest.json"))).passed, false);
});
test("source drift invalidates otherwise successful checks", async (t) => {
	const root = setup(t);
	let calls = 0;
	const report = await verify({
		root,
		snapshot: () => ({ digest: String(calls++) }),
		execute: async () => ({ passed: true, exitCode: 0 }),
	});
	assert.equal(report.sourceStable, false);
	assert.equal(report.passed, false);
});
test("requested Studio failures fail overall acceptance", async (t) => {
	const root = setup(t);
	let calls = 0;
	const report = await verify({
		root,
		studio: "fake-test-only",
		snapshot: () => ({ digest: "stable" }),
		execute: async () => ({ passed: ++calls < 7, exitCode: calls < 7 ? 0 : 1 }),
	});
	assert.equal(report.studio.status, "failed");
	assert.equal(report.passed, false);
});
test("snapshot covers tests and lockfile while ignoring generated artifacts", (t) => {
	const root = setup(t);
	fs.mkdirSync(path.join(root, "tests"));
	fs.writeFileSync(path.join(root, "tests/smoke.luau"), "before");
	fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
	const initial = sourceSnapshot(root).digest;
	fs.mkdirSync(path.join(root, "build"));
	fs.writeFileSync(path.join(root, "build/report.json"), "ignored");
	assert.equal(sourceSnapshot(root).digest, initial);
	fs.writeFileSync(path.join(root, "tests/smoke.luau"), "after");
	assert.notEqual(sourceSnapshot(root).digest, initial);
});
test("a zero Studio exit code without matching native evidence cannot pass", async (t) => {
	const root = setup(t);
	const report = await verify({
		root,
		studio: "fake-test-only",
		snapshot: () => ({ digest: "stable" }),
		execute: async () => ({ passed: true, exitCode: 0 }),
	});
	assert.equal(report.passed, false);
	assert.equal(report.studio.status, "failed");
	assert.equal(report.checks[6].status, "failed");
});
