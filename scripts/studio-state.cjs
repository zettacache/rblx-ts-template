const { decodeResult } = require("./studio-result.cjs");
function mode(state) {
	const match = state?.text?.match(/Current Studio Mode:\s*(Edit|Play)\b/);
	if (!match) throw Error("Unrecognized Studio state; inspect status manually.");
	return match[1];
}
function unavailable(error) {
	// These replies reject execution before the supplied Luau runs. Nothing else
	// (timeouts, permission errors, malformed results) is safe to retry here.
	return (
		/(?:Edit|Server|Client) datamodel is not available in (?:Edit|Play) mode/i.test(error.message) ||
		/Network action ExecuteLuau\.loadCode .*Target is not reachable .*No OnInvoke handler responded for this action/.test(
			error.message,
		)
	);
}
async function waitForContext(client, studio, context, options = {}) {
	if (!["Edit", "Server", "Client"].includes(context)) throw Error("Invalid data model context.");
	const pause = options.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	const attempts = options.attempts ?? 20;
	if (!Number.isInteger(attempts) || attempts < 2 || attempts > 100)
		throw Error("Readiness attempts must be 2..100.");
	const wanted = context === "Edit" ? "Edit" : "Play";
	let stable = 0,
		last = "no observation";
	for (let i = 0; i < attempts; i++) {
		const observed = mode(await client.call("get_studio_state", { studio_id: studio.id }));
		last = `reported ${observed}`;
		if (observed === wanted) {
			try {
				const value = decodeResult(
					await client.call("execute_luau", {
						studio_id: studio.id,
						datamodel_type: context,
						code: 'return game:GetService("HttpService"):JSONEncode({robloxStudio=1,ok=true,contextProbe=true,running=game:GetService("RunService"):IsRunning()})',
					}),
				);
				if (value.contextProbe !== true || typeof value.running !== "boolean")
					throw Error("Malformed Studio context readiness probe.");
				if (value.running === (wanted === "Play")) {
					if (++stable >= 2) return { mode: wanted, context, ready: true };
				} else {
					stable = 0;
					last = "RunService disagrees with mode label";
				}
			} catch (error) {
				if (!unavailable(error)) throw error;
				stable = 0;
				last = error.message;
			}
		} else stable = 0;
		if (i + 1 < attempts) await pause(250);
	}
	throw Error(
		`Studio ${context} context did not become ready (${last}); inspect Studio before any mutation.`,
	);
}
module.exports = { mode, unavailable, waitForContext };
