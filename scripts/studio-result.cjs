// Decode our explicit envelope, without treating arbitrary script output as success.
function decodeResult(data) {
	for (let i = 0; i < 5; i++) {
		if (data && data.robloxStudio === 1) {
			if (!data.ok) throw Error(data.error || "Studio authoring failed.");
			return data;
		}
		if (typeof data === "string") {
			try {
				data = JSON.parse(data);
				continue;
			} catch {}
		}
		if (data && typeof data.text === "string") {
			data = data.text;
			continue;
		}
		if (data && data.result !== undefined) {
			data = data.result;
			continue;
		}
		if (data && data.content?.length === 1 && data.content[0].type === "text") {
			data = data.content[0].text;
			continue;
		}
		break;
	}
	throw Error("Unrecognized Studio execution result; inspect it before retrying a mutation.");
}
module.exports = { decodeResult };
