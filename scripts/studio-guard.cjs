// Cooperative process guard. Direct MCP/manual Studio actors must follow the same queue.
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const cleanupScope = new AsyncLocalStorage();
const cleaning = () => cleanupScope.getStore() === true || process.env.STUDIO_RESERVATION_CLEANUP === "1";
// Only changes recovery eligibility within this async operation. Ownership,
// checkout, Studio and runtime-marker checks still apply.
const withCleanup = (fn) => cleanupScope.run(true, fn);
const ROOT = path.resolve(__dirname, "..");
const READ_ONLY = new Set([
	"list_roblox_studios",
	"get_studio_state",
	"get_console_output",
	"inspect_instance",
	"search_game_tree",
	"script_read",
	"script_search",
	"script_grep",
	"list_skills",
	"skill",
	"search_asset",
]);
function context(root = ROOT) {
	return require("./studio-reservation.cjs").contextFromEnvironment(root);
}
function assert(root = ROOT, studioId) {
	const ctx = context(root);
	if (studioId && studioId !== ctx.studioId) throw Error("Reservation targets a different Studio instance.");
	const owned = ctx.coordinator.assertOwnership({
		token: ctx.token,
		owner: ctx.owner,
		task: ctx.task,
		cleanup: cleaning(),
	});
	if (!require("./path-identity.cjs").samePath(owned.checkout, root))
		throw Error("Reservation belongs to a different checkout.");
	return ctx;
}
function begin(root = ROOT, studioId, operation) {
	const ctx = assert(root, studioId);
	const span = ctx.coordinator.beginOperation({ token: ctx.token, operation, cleanup: cleaning() });
	return { ctx, span };
}
function end(ctx, span) {
	return ctx.coordinator.endOperation({
		token: ctx.token,
		operationId: typeof span === "string" ? span : span.operationId,
	});
}
async function tool(name, args, send) {
	// Status is observation only, never a substitute for acquiring before preflight.
	if (READ_ONLY.has(name)) return send();
	if (!args.studio_id) throw Error("Guarded Studio operations require an explicit studio_id.");
	const { ctx, span } = begin(ROOT, args.studio_id, "mcp:" + name);
	try {
		const result = await send();
		if (result?.isError) throw Error(JSON.stringify(result.content));
		end(ctx, span);
		return result;
	} catch (error) {
		// These specific bridge rejections happen before supplied code can execute.
		if (require("./studio-state.cjs").unavailable(error)) {
			end(ctx, span);
			throw error;
		}
		ctx.coordinator.markRecovery({
			token: ctx.token,
			reason: "Studio operation failed or response is ambiguous: " + name,
		});
		throw error;
	}
}
module.exports = { context, assert, begin, end, tool, READ_ONLY, withCleanup };
