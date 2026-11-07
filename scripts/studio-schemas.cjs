// Cache only schema discovery, never Studio state or ownership observations.
const caches = new WeakMap();
async function schemas(client) {
	if (client.closed || client.failure) throw Error("Cannot discover tools on a closed or failed bridge.");
	const version = client.toolListVersion || 0;
	let entry = caches.get(client);
	if (!entry || entry.version !== version) {
		entry = { version };
		entry.promise = (async () => {
			const found = new Map(),
				cursors = new Set();
			let cursor;
			do {
				const page = await client.request("tools/list", cursor ? { cursor } : {});
				if (!Array.isArray(page.tools)) throw Error("Malformed tool schema page.");
				for (const tool of page.tools) {
					if (
						!tool ||
						typeof tool.name !== "string" ||
						!tool.inputSchema ||
						typeof tool.inputSchema !== "object"
					)
						throw Error("Malformed tool schema.");
					if (found.has(tool.name)) throw Error("Duplicate tool schema: " + tool.name);
					found.set(tool.name, tool.inputSchema);
				}
				cursor = page.nextCursor;
				if (
					cursor !== undefined &&
					cursor !== null &&
					(typeof cursor !== "string" || !cursor || cursors.has(cursor))
				)
					throw Error("Invalid or repeated tool schema cursor.");
				if (cursor) cursors.add(cursor);
			} while (cursor);
			if (client.closed || client.failure || (client.toolListVersion || 0) !== version)
				throw Error("Tool schemas changed during discovery; rerun preflight.");
			return found;
		})();
		caches.set(client, entry);
	}
	try {
		return new Map(await entry.promise);
	} catch (error) {
		if (caches.get(client) === entry) caches.delete(client);
		throw error;
	}
}
module.exports = { schemas };
