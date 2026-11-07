// Shared simulator setup. Snapshot before any mutation; select device before orientation.
const fs = require("node:fs");
const path = require("node:path");
const { luaString, decodeResult } = require("./studio-author.cjs");
function validateDevice(value) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((k) => !["name", "id", "orientation"].includes(k))
	)
		throw Error("device needs name or id and optional orientation.");
	if (["name", "id"].some((k) => value[k] !== undefined && typeof value[k] !== "string"))
		throw Error("Device name/id must be a string.");
	if (
		(typeof value.name === "string") === (typeof value.id === "string") ||
		!(value.name || value.id)?.trim()
	)
		throw Error("Specify exactly one device name or id.");
	if (
		value.orientation !== undefined &&
		!["Portrait", "LandscapeLeft", "LandscapeRight"].includes(value.orientation)
	)
		throw Error("Invalid device orientation.");
	if (value.id === "default" && value.orientation !== undefined)
		throw Error("The default desktop device does not accept orientation changes.");
	return { ...value };
}
async function request(client, studio, action, value) {
	const code =
		'local request=game:GetService("HttpService"):JSONDecode(' +
		luaString(JSON.stringify({ action, value })) +
		")\n" +
		fs.readFileSync(path.join(__dirname, "studio-device.luau"), "utf8");
	return decodeResult(
		await client.call("execute_luau", { studio_id: studio.id, datamodel_type: "Edit", code }),
	).value;
}
const snapshot = (client, studio) => request(client, studio, "snapshot");
const configure = (client, studio, value) => request(client, studio, "configure", validateDevice(value));
const restore = (client, studio, value) => request(client, studio, "restore", value);
module.exports = { validateDevice, snapshot, configure, restore };
