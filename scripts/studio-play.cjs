#!/usr/bin/env node
// Explicit playtest ownership: never stop a session this tool did not start.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { decodeResult } = require("./studio-author.cjs");
const { McpClient, findBridge } = require("./studio-mcp-client.cjs");
const { chooseStudio } = require("./studio.cjs");
const { mode, waitForContext } = require("./studio-state.cjs");
async function verifyOwnership(client, studio, file) {
	const owned = JSON.parse(fs.readFileSync(file, "utf8"));
	if (owned.studioId !== studio.id || owned.status !== "running")
		throw Error("No owned playtest in this Studio session.");
	if (mode(await client.call("get_studio_state", { studio_id: studio.id })) !== "Play")
		throw Error("Owned playtest is no longer running.");
	const marker = decodeResult(
		await client.call("execute_luau", {
			studio_id: studio.id,
			datamodel_type: "Server",
			code: 'assert(game:GetService("RunService"):IsRunning(), "Play mode required")\nreturn game:GetService("HttpService"):JSONEncode({robloxStudio=1,ok=true,token=game:GetAttribute("RobloxToolsToolingSession") or ""})',
		}),
	);
	if (marker.token !== owned.token)
		throw Error("Playtest ownership marker changed; refusing to control a different test.");
	return owned;
}
async function lifecycle(
	client,
	studio,
	action,
	file,
	pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
	// The turn journal is written before a start can mutate Studio. Runtime token
	// checks remain authoritative for stopping; a queue token never replaces them.
	if (action === "start") require("./studio-turn.cjs").registerSession(file);
	const current = mode(await client.call("get_studio_state", { studio_id: studio.id }));
	if (action === "start") {
		if (current !== "Edit") throw Error("A playtest is already active; refusing to take ownership.");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify(
				{ studioId: studio.id, token: randomUUID(), status: "starting", startedAt: new Date().toISOString() },
				null,
				2,
			),
			{ flag: "wx" },
		);
	} else if (action === "stop") {
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		if (record.studioId !== studio.id || record.status !== "running")
			throw Error("No owned playtest in this Studio session.");
		if (current !== "Play")
			throw Error("Owned playtest is no longer running; inspect before removing its session record.");
	} else throw Error("Expected start or stop.");
	try {
		const owned = JSON.parse(fs.readFileSync(file, "utf8"));
		if (action === "stop") {
			const marker = decodeResult(
				await client.call("execute_luau", {
					studio_id: studio.id,
					datamodel_type: "Server",
					code: `assert(game:GetService("RunService"):IsRunning(), "Play mode required")\nreturn game:GetService("HttpService"):JSONEncode({robloxStudio=1,ok=true,token=game:GetAttribute("RobloxToolsToolingSession") or ""})`,
				}),
			);
			if (marker.token !== owned.token)
				throw Error("Playtest ownership marker changed; refusing to stop a different test.");
		}
		await client.call("start_stop_play", { studio_id: studio.id, is_start: action === "start" });
		const { mode: observed } = await waitForContext(client, studio, action === "start" ? "Server" : "Edit", {
			pause,
		});
		if (action === "start") {
			// Runtime-only marker vanishes when this playtest ends. A manually restarted
			// test in the same Studio cannot be mistaken for the one we started.
			const marker = decodeResult(
				await client.call("execute_luau", {
					studio_id: studio.id,
					datamodel_type: "Server",
					code: `assert(game:GetService("RunService"):IsRunning(), "Play mode required")\nassert(game:GetAttribute("RobloxToolsToolingSession")==nil,"Existing test owner")\ngame:SetAttribute("RobloxToolsToolingSession","${owned.token}")\nreturn game:GetService("HttpService"):JSONEncode({robloxStudio=1,ok=true,token=game:GetAttribute("RobloxToolsToolingSession")})`,
				}),
			);
			if (marker.token !== owned.token) throw Error("Could not verify playtest ownership.");
			// Record ownership before probing Client: if that context fails to load,
			// callers can still clean up only the runtime whose marker we verified.
			const marked = JSON.parse(fs.readFileSync(file, "utf8"));
			marked.status = "running";
			fs.writeFileSync(file, JSON.stringify(marked, null, 2));
			try {
				await waitForContext(client, studio, "Client", { pause });
			} catch (error) {
				try {
					await lifecycle(client, studio, "stop", file, pause);
				} catch (cleanup) {
					throw Error(`${error.message} Owned cleanup failed: ${cleanup.message}`, { cause: cleanup });
				}
				throw Error(`${error.message} Owned playtest was stopped.`, { cause: error });
			}
		}
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		record.status = action === "start" ? "running" : "stopped";
		record.updatedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(record, null, 2));
		return { action, studio, mode: observed, sessionFile: file };
	} catch (error) {
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		if (record.status !== "stopped") record.status = "unconfirmed";
		record.error = error.message;
		fs.writeFileSync(file, JSON.stringify(record, null, 2));
		throw error;
	}
}
async function main(argv = process.argv.slice(2)) {
	if (argv.length === 0 || argv[0] === "--help")
		return process.stdout.write(
			`Owned Studio playtests (direct Roblox bridge)\nnode scripts/studio-play.cjs start|stop --session <build/session.json>\nUse a unique session file per test. Run assertions with studio exec in Server/Client context.\nStop using the same file when done. Existing/manual sessions are never adopted.\n`,
		);
	if (argv.length !== 3 || argv[1] !== "--session" || !["start", "stop"].includes(argv[0]))
		throw Error("Use start|stop --session <file.json>.");
	const settings = require("./studio-config.cjs").read();
	const client = new McpClient(findBridge());
	try {
		await client.connect();
		const studio = chooseStudio(
			await client.call("list_roblox_studios"),
			undefined,
			settings.expectedPlaceId,
		);
		process.stdout.write(
			JSON.stringify(await lifecycle(client, studio, argv[0], path.resolve(argv[2])), null, 2) + "\n",
		);
	} finally {
		client.close();
	}
}
if (require.main === module)
	main().catch((error) => {
		process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
		process.exitCode = 1;
	});
module.exports = { mode, lifecycle, verifyOwnership };
