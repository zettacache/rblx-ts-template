const test = require("node:test");
const assert = require("node:assert/strict");
const { runSmoke } = require("./studio-smoke-run.cjs");
const { verifyTarget } = require("./studio-turn.cjs");
test("unpublished file targets require native PlaceId zero; published targets cannot use a filename", async () => {
	const calls = [];
	const client = {
		call: async (name, args) => {
			calls.push({ name, args });
			return { robloxStudio: 1, ok: true, placeId: "0" };
		},
	};
	await verifyTarget(client, { id: "fixture", name: "smoke.rbxlx" }, "0");
	assert.equal(calls[0].args.datamodel_type, "Edit");
	await assert.rejects(
		verifyTarget(client, { id: "fixture", name: "smoke.rbxlx" }, "123"),
		/configured place/,
	);
	await assert.rejects(
		verifyTarget(
			{ call: async () => ({ robloxStudio: 1, ok: true, placeId: "123" }) },
			{ id: "fixture", name: "smoke.rbxlx" },
			"0",
		),
		/unpublished/,
	);
});
test("smoke refuses another place or stale build before starting a test", async () => {
	let started = false;
	const client = { call: async () => ({ robloxStudio: 1, ok: true, digest: "different" }) };
	await assert.rejects(
		runSmoke(client, { id: "fixture" }, { digest: "expected" }, {}, async () => {
			started = true;
		}),
		/current smoke build/,
	);
	assert.equal(started, false);
});
test("smoke forwards scenario failure and owned-session evidence unchanged", async () => {
	const client = { call: async () => ({ robloxStudio: 1, ok: true, digest: "expected" }) };
	const result = { passed: false, error: "assertion failed", cleanup: { mode: "Edit" } };
	const observed = await runSmoke(
		client,
		{ id: "fixture" },
		{ digest: "expected" },
		{ session: "fixture-only" },
		async (_client, _studio, document, options) => {
			assert.equal(document.steps[2].kind, "click");
			assert.equal(options.session, "fixture-only");
			return result;
		},
	);
	assert.equal(observed, result);
});
