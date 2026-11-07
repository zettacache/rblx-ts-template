// Preloaded by the batch runner before a fixture's CLI can execute. The parent
// registers the exact PID first, then opens this gate; session registration can
// therefore never overwrite a concurrent managed-process receipt update.
const fs = require("node:fs");
const path = require("node:path");
const gate = process.env.STUDIO_VERIFICATION_GATE;
const identity = process.env.STUDIO_VERIFICATION_GATE_ID;
const timeout = Number(process.env.STUDIO_VERIFICATION_GATE_TIMEOUT_MS || 10000);
if (
	!gate ||
	!path.isAbsolute(gate) ||
	!identity ||
	!Number.isInteger(timeout) ||
	timeout < 100 ||
	timeout > 10000
) {
	throw Error("Missing or invalid verification launch gate");
}
const deadline = Date.now() + timeout;
const delay = new Int32Array(new SharedArrayBuffer(4));
while (true) {
	if (fs.existsSync(gate)) {
		if (JSON.parse(fs.readFileSync(gate, "utf8")).id !== identity)
			throw Error("Verification launch gate identity mismatch");
		break;
	}
	if (Date.now() >= deadline) throw Error("Verification launch gate was not opened; fixture was not started");
	Atomics.wait(delay, 0, 0, 10);
}
