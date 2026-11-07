const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { performance } = require("node:perf_hooks");

// Reuse Roblox's installed bridge, including its existing authentication.
// Never read or copy StudioMCP/auth.token into this project.
function findBridge() {
	if (process.env.ROBLOX_STUDIO_MCP_EXE) {
		const override = path.resolve(process.env.ROBLOX_STUDIO_MCP_EXE);
		if (!fs.existsSync(override)) throw new Error("ROBLOX_STUDIO_MCP_EXE does not exist.");
		return override;
	}
	const locations = [process.env.LOCALAPPDATA, path.join(os.homedir(), "AppData", "Local")].filter(Boolean);
	for (const local of new Set(locations)) {
		const roblox = path.join(local, "Roblox");
		const launcher = path.join(roblox, "mcp.bat");
		if (fs.existsSync(launcher)) {
			const matches = fs.readFileSync(launcher, "utf8").matchAll(/"([^"\r\n]*StudioMCP\.exe)"/gi);
			for (const match of matches) if (fs.existsSync(match[1])) return match[1];
		}
		const versions = path.join(roblox, "Versions");
		if (fs.existsSync(versions)) {
			const candidates = fs
				.readdirSync(versions, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && entry.name.startsWith("version-"))
				.map((entry) => path.join(versions, entry.name, "StudioMCP.exe"))
				.filter((file) => fs.existsSync(file))
				.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
			if (candidates.length) return candidates[0];
		}
	}
	throw new Error("StudioMCP.exe not found. Update/open Roblox Studio or set ROBLOX_STUDIO_MCP_EXE.");
}

class McpClient {
	constructor(command, args = ["--stdio"], timeoutMs = 30000, options = {}) {
		this.guard = options.guard || require("./studio-guard.cjs").tool;
		this.child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
		this.timeoutMs = timeoutMs;
		this.sequence = 0;
		this.pending = new Map();
		this.toolListVersion = 0;
		this.timings = new Map();
		this.tracePath = options.tracePath ?? process.env.STUDIO_MCP_TRACE;
		this.traceWarning = options.traceWarning || ((message) => process.stderr.write(message + "\n"));
		this.diagnostics = "";
		this.child.stderr.on("data", (chunk) => {
			this.diagnostics = (this.diagnostics + chunk.toString()).slice(-4000);
		});
		this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
		this.lines.on("line", (line) => {
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				return this.fail(new Error("Bridge sent invalid JSON on stdout."));
			}
			if (message.id === undefined) {
				if (message.method === "notifications/tools/list_changed") this.toolListVersion++;
				return;
			}
			const pending = this.pending.get(message.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(message.id);
			if (message.error)
				pending.finish("protocol-error", new Error(message.error.message || JSON.stringify(message.error)));
			else pending.finish(message.result?.isError ? "tool-error" : "ok", null, message.result);
		});
		this.child.on("error", (error) => this.fail(error));
		this.child.stdin.on("error", (error) => this.fail(error));
		this.child.on("exit", (code) => {
			this.closed = true;
			this.fail(new Error(`Studio bridge exited (${code}). ${this.diagnostics}`.trim()));
		});
	}

	fail(error) {
		this.failure = error;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.finish("transport-error", error);
		}
		this.pending.clear();
	}

	request(method, params = {}) {
		if (method === "tools/call")
			return this.guard(params.name, params.arguments || {}, () => this.send(method, params));
		return this.send(method, params);
	}

	send(method, params = {}) {
		if (this.failure) return Promise.reject(this.failure);
		if (this.closed) return Promise.reject(new Error("Studio bridge is closed."));
		const id = ++this.sequence;
		const started = performance.now();
		const timeoutMs = this.timeoutMs;
		// Intentionally exclude arguments, source, responses, and error text.
		const meta = {
			method,
			...(method === "tools/call"
				? {
						tool: params.name,
						...(["Edit", "Server", "Client"].includes(params.arguments?.datamodel_type)
							? { context: params.arguments.datamodel_type }
							: {}),
					}
				: {}),
		};
		const label = [method, meta.tool, meta.context].filter(Boolean).join(" / ");
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (outcome, error, result) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				this.pending.delete(id);
				this.recordTiming({ id, ...meta, elapsedMs: performance.now() - started, outcome });
				if (error) reject(error);
				else resolve(result);
			};
			const timer = setTimeout(() => {
				const error = new Error(
					`Timed out after ${timeoutMs}ms: ${label} (request ${id}). Check Studio MCP connection; reconcile state before repeating a mutation.`,
				);
				error.code = "STUDIO_MCP_TIMEOUT";
				finish("timeout", error);
			}, timeoutMs);
			this.pending.set(id, { finish, timer });
			this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	}

	recordTiming(event) {
		const key = JSON.stringify([event.method, event.tool, event.context]);
		const row = this.timings.get(key) || {
			method: event.method,
			...(event.tool ? { tool: event.tool } : {}),
			...(event.context ? { context: event.context } : {}),
			count: 0,
			totalMs: 0,
			maxMs: 0,
			failures: 0,
			timeouts: 0,
		};
		row.count++;
		row.totalMs += event.elapsedMs;
		row.maxMs = Math.max(row.maxMs, event.elapsedMs);
		if (event.outcome !== "ok") row.failures++;
		if (event.outcome === "timeout") row.timeouts++;
		this.timings.set(key, row);
		if (this.tracePath) {
			try {
				fs.mkdirSync(path.dirname(path.resolve(this.tracePath)), { recursive: true });
				fs.appendFileSync(
					this.tracePath,
					JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...event }) + "\n",
				);
			} catch {
				this.tracePath = undefined;
				// A diagnostics disk failure must never obscure an accepted mutation.
				try {
					this.traceWarning("Studio timing trace unavailable; continuing without trace output.");
				} catch {}
			}
		}
	}

	timingSummary() {
		return [...this.timings.values()].map((row) => ({ ...row, meanMs: row.totalMs / row.count }));
	}

	async connect() {
		const info = await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "roblox-studio-cli", version: "1.0.0" },
		});
		this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
		return info;
	}

	async callRaw(name, args = {}) {
		const result = await this.request("tools/call", { name, arguments: args });
		if (result.isError) throw new Error(JSON.stringify(result.content));
		return result;
	}

	async call(name, args = {}) {
		const result = await this.callRaw(name, args);
		if (result.structuredContent !== undefined) return result.structuredContent;
		const blocks = result.content || [];
		if (blocks.length === 1 && blocks[0].type === "text") {
			try {
				return JSON.parse(blocks[0].text);
			} catch {
				return { text: blocks[0].text };
			}
		}
		return { content: blocks };
	}

	close() {
		this.closed = true;
		this.toolListVersion++;
		this.fail(new Error("Studio CLI session closed."));
		this.lines.close();
		this.child.stdin.destroy();
		this.child.stdout.destroy();
		this.child.stderr.destroy();
		this.child.kill(); // Only the proxy this CLI spawned, never Studio itself.
	}
}

module.exports = { McpClient, findBridge };
