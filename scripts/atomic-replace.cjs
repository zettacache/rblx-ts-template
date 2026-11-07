const fs = require("node:fs");
function atomicReplace(source, destination, options = {}) {
	const rename = options.rename || fs.renameSync;
	const pause = options.pause || ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
	const attempts = options.attempts ?? 9;
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > 25)
		throw Error("Atomic replacement attempts must be 1..25.");
	for (let index = 0; index < attempts; index++) {
		try {
			rename(source, destination);
			return;
		} catch (error) {
			if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || index === attempts - 1) throw error;
			// Same frozen temporary file and destination; never delete the current ledger/cache pointer.
			pause(Math.min((index + 1) * 10, 50));
		}
	}
}
module.exports = { atomicReplace };
