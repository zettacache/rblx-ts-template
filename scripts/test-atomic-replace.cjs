const test = require("node:test"),
	assert = require("node:assert/strict");
const { atomicReplace } = require("./atomic-replace.cjs");
test("atomic replacement retries only transient filesystem locks with a fixed bound", () => {
	let attempts = 0,
		waits = 0;
	atomicReplace("frozen.tmp", "ledger.json", {
		rename: (from, to) => {
			assert.equal(from, "frozen.tmp");
			assert.equal(to, "ledger.json");
			if (++attempts < 3) throw Object.assign(Error("locked"), { code: "EPERM" });
		},
		pause: () => waits++,
	});
	assert.equal(attempts, 3);
	assert.equal(waits, 2);
	attempts = 0;
	assert.throws(
		() =>
			atomicReplace("a", "b", {
				attempts: 2,
				pause: () => {},
				rename: () => {
					attempts++;
					throw Object.assign(Error("locked"), { code: "EBUSY" });
				},
			}),
		/locked/,
	);
	assert.equal(attempts, 2);
	assert.throws(
		() =>
			atomicReplace("a", "b", {
				pause: () => assert.fail(),
				rename: () => {
					throw Object.assign(Error("missing"), { code: "ENOENT" });
				},
			}),
		/missing/,
	);
});
