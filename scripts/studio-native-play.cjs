// Owned single-player tests using StudioTestService instead of the convenience
// start_stop_play tool. Runtime args and markers both verify session ownership.
const fs = require("node:fs"),
	path = require("node:path"),
	crypto = require("node:crypto");
const { decodeResult } = require("./studio-author.cjs");
const { mode, waitForContext } = require("./studio-state.cjs");
const { verifyOwnership } = require("./studio-play.cjs");
async function lifecycle(
	client,
	studio,
	action,
	file,
	pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
	if (action === "start") require("./studio-turn.cjs").registerSession(file);
	const current = mode(await client.call("get_studio_state", { studio_id: studio.id }));
	const exec = async (context, code) =>
		decodeResult(await client.call("execute_luau", { studio_id: studio.id, datamodel_type: context, code }));
	if (action === "start") {
		if (current !== "Edit") throw Error("Another test is active");
		const record = {
			studioId: studio.id,
			token: crypto.randomUUID(),
			status: "starting",
			transport: "StudioTestService",
			startedAt: new Date().toISOString(),
		};
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: "wx" });
		try {
			await exec(
				"Edit",
				`assert(not game:GetService('RunService'):IsRunning());assert(game:GetAttribute('RobloxToolsNativeStart')==nil,'Existing native test owner')
game:SetAttribute('RobloxToolsNativeStart','${record.token}')
task.spawn(function()
 local ok,result=pcall(function()return game:GetService('StudioTestService'):ExecutePlayModeAsync({robloxToolsToken='${record.token}'})end)
 game:SetAttribute('RobloxToolsNativeResult',game.HttpService:JSONEncode({token='${record.token}',ok=ok,result=tostring(result)}))
 game:SetAttribute('RobloxToolsNativeStart',nil)
end)
return game.HttpService:JSONEncode({robloxStudio=1,ok=true})`,
			);
			await waitForContext(client, studio, "Server", { attempts: 100, pause });
			await exec(
				"Server",
				`local args=game:GetService('StudioTestService'):GetTestArgs();assert(args.robloxToolsToken=='${record.token}','Different test args');assert(game:GetAttribute('RobloxToolsToolingSession')==nil);game:SetAttribute('RobloxToolsToolingSession','${record.token}');return game.HttpService:JSONEncode({robloxStudio=1,ok=true})`,
			);
			record.status = "running";
			fs.writeFileSync(file, JSON.stringify(record, null, 2));
			try {
				await waitForContext(client, studio, "Client", { attempts: 100, pause });
			} catch (error) {
				await lifecycle(client, studio, "stop", file, pause);
				throw error;
			}
		} catch (error) {
			const r = JSON.parse(fs.readFileSync(file, "utf8"));
			if (r.status !== "stopped") r.status = "unconfirmed";
			r.error = error.message;
			fs.writeFileSync(file, JSON.stringify(r, null, 2));
			throw error;
		}
	} else if (action === "stop") {
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		if (
			record.studioId !== studio.id ||
			record.status !== "running" ||
			record.transport !== "StudioTestService" ||
			!/^[a-f0-9-]{36}$/.test(record.token)
		)
			throw Error("No confirmed owned native session to stop or reconcile");
		if (current === "Play") {
			await verifyOwnership(client, studio, file);
			await exec(
				"Server",
				`local t=game:GetService('StudioTestService');assert(t:GetTestArgs().robloxToolsToken=='${record.token}');task.defer(function()t:EndTest('Owned test finished')end);return game.HttpService:JSONEncode({robloxStudio=1,ok=true})`,
			);
		}
		await waitForContext(client, studio, "Edit", { attempts: 100, pause });
		let finished = false;
		for (let attempt = 0; attempt < 80; attempt++) {
			const callback = await exec(
				"Edit",
				`return game.HttpService:JSONEncode({robloxStudio=1,ok=true,pending=game:GetAttribute('RobloxToolsNativeStart') or '',result=game:GetAttribute('RobloxToolsNativeResult') or ''})`,
			);
			if (callback.pending === "") {
				let result;
				try {
					result = JSON.parse(callback.result);
				} catch {
					throw Error("Missing native completion receipt; preserve recovery state");
				}
				if (result.token !== record.token || typeof result.ok !== "boolean")
					throw Error("Native callback ownership changed or completion receipt is malformed");
				record.completionOk = result.ok;
				finished = true;
				break;
			}
			if (callback.pending !== record.token) throw Error("Native callback ownership changed");
			await pause(500);
		}
		if (!finished) throw Error("Owned native callback has not returned; preserve recovery state");
		await exec(
			"Edit",
			`assert(not game:GetService('RunService'):IsRunning());assert(game:GetAttribute('RobloxToolsNativeStart')==nil);local result=assert(game:GetAttribute('RobloxToolsNativeResult'),'Missing completion receipt');assert(game.HttpService:JSONDecode(result).token=='${record.token}');game:SetAttribute('RobloxToolsNativeResult',nil);return game.HttpService:JSONEncode({robloxStudio=1,ok=true})`,
		);
		record.stopReconciled = current === "Edit";
		record.status = "stopped";
		record.updatedAt = new Date().toISOString();
		fs.writeFileSync(file, JSON.stringify(record, null, 2));
	} else throw Error("Unknown lifecycle action");
	return { action, studio, mode: action === "start" ? "Play" : "Edit", sessionFile: file };
}
module.exports = { lifecycle, verifyOwnership };
