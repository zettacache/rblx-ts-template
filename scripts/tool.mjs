import { tool } from "./lib.mjs";
const [name, ...args] = process.argv.slice(2);
if (!["rojo", "lune"].includes(name)) throw new Error("Expected rojo or lune");
tool(name, args);
