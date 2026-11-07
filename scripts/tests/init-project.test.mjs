import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeProject } from "../init-project.mjs";

test("initialization updates names and optional Rojo place restriction without changing dependencies", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "rbxts-template-"));
	try {
		for (const [file, data] of [
			["package.json", { name: "template", dependencies: { example: "1.0.0" } }],
			["package-lock.json", { name: "template", packages: { "": { name: "template" } } }],
			["default.project.json", { name: "template", tree: { $className: "DataModel" } }],
			["studio-tools.json", { expectedPlaceId: null }],
		])
			writeFileSync(path.join(directory, file), JSON.stringify(data));
		writeFileSync(path.join(directory, "README.md"), "# Template\n\nInstructions\n");
		initializeProject(directory, "example-game", "123");
		const read = (name) => JSON.parse(readFileSync(path.join(directory, name), "utf8"));
		assert.equal(read("package.json").name, "example-game");
		assert.deepEqual(read("package.json").dependencies, { example: "1.0.0" });
		assert.equal(read("package-lock.json").packages[""].name, "example-game");
		assert.deepEqual(read("default.project.json").servePlaceIds, [123]);
		assert.equal(read("studio-tools.json").expectedPlaceId, "123");
		assert.equal(readFileSync(path.join(directory, "README.md"), "utf8"), "# example-game\n\nInstructions\n");
		assert.throws(() => initializeProject(directory, "../bad"));
		assert.throws(() => initializeProject(directory, "valid", "9007199254740993"));
		initializeProject(directory, "renamed-game");
		assert.deepEqual(read("default.project.json").servePlaceIds, [123]);
		assert.equal(read("studio-tools.json").expectedPlaceId, "123");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
