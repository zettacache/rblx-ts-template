const fs = require("node:fs");
const path = require("node:path");
function read(root = path.resolve(__dirname, "..")) {
	return JSON.parse(fs.readFileSync(path.join(root, "studio-tools.json"), "utf8"));
}
module.exports = { read };
