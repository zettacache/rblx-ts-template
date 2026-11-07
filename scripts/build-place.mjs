import { mkdirSync } from "node:fs";
import { tool } from "./lib.mjs";

const tests = process.argv.includes("--test");
mkdirSync(new URL("../build/", import.meta.url), { recursive: true });
tool("rojo", [
	"build",
	tests ? "test.project.json" : "default.project.json",
	"--output",
	tests ? "build/tests.rbxl" : "build/game.rbxlx",
]);
