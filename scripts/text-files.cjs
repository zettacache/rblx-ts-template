// Windows PowerShell redirection commonly produces BOM-marked UTF-16. Accept
// explicit Unicode encodings, while refusing silent replacement of bad bytes.
const fs = require("node:fs");
function decodeText(bytes, label = "input") {
	let encoding = "utf-8";
	if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
	else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
	try {
		const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
		if (text.includes("\0")) throw Error("NUL bytes; use UTF-8 or BOM-marked UTF-16");
		return text;
	} catch (error) {
		throw Error(`Cannot decode ${label}: ${error.message}`, { cause: error });
	}
}
const readText = (file) => decodeText(fs.readFileSync(file), file);
const readJson = (file) => JSON.parse(readText(file));
module.exports = { decodeText, readText, readJson };
