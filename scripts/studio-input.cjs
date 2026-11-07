// Calibrated native GUI clicks. Calibration input is intercepted by a temporary
// overlay; the requested game button is clicked once, never retried on ambiguity.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { luaString, decodeResult } = require("./studio-author.cjs");
const { verifyOwnership } = require("./studio-play.cjs");
function validateClick(args) {
	if (
		!args ||
		Object.keys(args).some((k) => k !== "instance_path") ||
		typeof args.instance_path !== "string" ||
		!/^LocalPlayer\.PlayerGui\.[A-Za-z0-9_ -]+(?:\.[A-Za-z0-9_ -]+)*$/.test(args.instance_path)
	)
		throw Error("click requires instance_path under LocalPlayer.PlayerGui.");
	return args;
}
function nativeClickArguments(studioId, point) {
	return {
		studio_id: studioId,
		datamodel_type: "Client",
		actions: [
			{ action: "moveTo", x: point.x, y: point.y },
			{ action: "wait", wait_time_ms: 100 },
			{ action: "mouseButtonDown", mouse_button: "left" },
			{ action: "wait", wait_time_ms: 80 },
			{ action: "mouseButtonUp", mouse_button: "left" },
			{ action: "wait", wait_time_ms: 150 },
		],
	};
}
async function click(client, studio, args, session, state = {}) {
	validateClick(args);
	const key = "RobloxToolsInput_" + randomUUID().replaceAll("-", "");
	const probe = async (action, extra = {}) => {
		await verifyOwnership(client, studio, session);
		const code =
			'local request=game:GetService("HttpService"):JSONDecode(' +
			luaString(JSON.stringify({ action, key, path: args.instance_path, ...extra })) +
			")\n" +
			fs.readFileSync(path.join(__dirname, "studio-input.luau"), "utf8");
		return decodeResult(
			await client.call("execute_luau", { studio_id: studio.id, datamodel_type: "Client", code }),
		).value;
	};
	const native = async (point) => {
		await verifyOwnership(client, studio, session);
		const result = await client.call("user_mouse_input", nativeClickArguments(studio.id, point));
		if (
			result?.success === false ||
			result?.error ||
			/^\s*(error\b|failed\b|unable\b)/i.test(result?.text || "")
		)
			throw Error("Native click failed: " + JSON.stringify(result));
	};
	let value, error;
	try {
		let target = await probe("target");
		const signature = JSON.stringify([studio.id, path.resolve(session), target.viewport]);
		if (state.signature !== signature) {
			delete state.signature;
			const sent = await probe("calibrate");
			await native(sent);
			const received = await probe("measured");
			const offset = { x: sent.x - received.x, y: sent.y - received.y };
			if (
				![offset.x, offset.y].every(Number.isFinite) ||
				Math.abs(offset.x) > 200 ||
				Math.abs(offset.y) > 200
			)
				throw Error("Unexpected native input offset; no game button clicked.");
			state.offset = offset;
			state.signature = signature;
		}
		// Re-read after calibration; menus may have resized while input was measured.
		target = await probe("arm");
		if (JSON.stringify([studio.id, path.resolve(session), target.viewport]) !== state.signature)
			throw Error("Viewport changed during click; rerun after layout settles.");
		await native({ x: target.x + state.offset.x, y: target.y + state.offset.y });
		const observed = await probe("activated");
		if (observed.count !== 1)
			throw Error(
				"Native click did not activate the requested button exactly once; no retry sent. Input hit trace: " +
					JSON.stringify(observed.trace || null),
			);
		value = {
			instance_path: args.instance_path,
			offset: state.offset,
			inputType: observed.inputType,
			activations: observed.count,
		};
	} catch (failure) {
		error = failure;
		delete state.signature;
	} finally {
		try {
			await probe("cleanup");
		} catch (cleanup) {
			error = Error((error ? error.message + " " : "") + "Input cleanup failed: " + cleanup.message);
		}
	}
	if (error) {
		delete state.signature;
		throw error;
	}
	return value;
}
module.exports = { validateClick, nativeClickArguments, click };
