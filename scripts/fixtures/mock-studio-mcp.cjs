// Test-only stdio peer; does not load Roblox or connect to Studio.
const { createInterface } = require("node:readline");
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
	const message = JSON.parse(line);
	if (message.id === undefined) return;
	if (message.method === "hang") return;
	if (message.method === "crash") process.exit(7);
	const respond = (result) =>
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
	if (message.method === "initialize")
		return respond({
			protocolVersion: "2024-11-05",
			capabilities: {},
			serverInfo: { name: "mock", version: "1" },
		});
	if (message.method === "tools/call") {
		if (message.params.name === "delayed") return setTimeout(() => respond({ content: [] }), 120);
		if (message.params.name === "broken")
			return respond({ isError: true, content: [{ type: "text", text: "Invalid instance" }] });
		return respond({
			content: [{ type: "text", text: JSON.stringify({ received: message.params.arguments }) }],
		});
	}
	if (message.method === "notify-tools-changed") {
		process.stdout.write(
			JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n",
		);
		return respond({ ok: true });
	}
	if (message.method === "tools/list")
		return respond({ tools: [{ name: "query", inputSchema: { type: "object" } }] });
	if (message.method === "rpc-error")
		return process.stdout.write(
			JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } }) +
				"\n",
		);
	respond({ ok: true });
});
