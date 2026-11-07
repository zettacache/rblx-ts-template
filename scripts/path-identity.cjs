const path = require("node:path");
function samePath(a, b) {
	const first = path.resolve(a),
		second = path.resolve(b);
	return process.platform === "win32" ? first.toLowerCase() === second.toLowerCase() : first === second;
}
module.exports = { samePath };
