/// <reference types="@rbxts/testez/globals" />
import { createSystemRunner } from "shared/ecs/system-runner";

export = () => {
	it("runs in declared order and forwards delta time", () => {
		const calls = new Array<string>();
		const runner = createSystemRunner([
			{ name: "first", run: (dt) => calls.push(`first:${dt}`) },
			{ name: "second", run: () => calls.push("second") },
		]);
		runner.step(0.5);
		expect(calls.join(",")).to.equal("first:0.5,second");
		expect(runner.getTimings().size()).to.equal(0);
	});
	it("reports the failing system and stops the remaining systems", () => {
		let continued = false;
		const runner = createSystemRunner([
			{ name: "broken", run: () => error("test failure") },
			{
				name: "later",
				run: () => {
					continued = true;
				},
			},
		]);
		const [ok, message] = pcall(() => runner.step(0));
		expect(ok).to.equal(false);
		expect(tostring(message).find('System "broken" failed')[0] !== undefined).to.equal(true);
		expect(continued).to.equal(false);
	});
	it("rejects ambiguous duplicate system names", () => {
		expect(() =>
			createSystemRunner([
				{ name: "duplicate", run: () => {} },
				{ name: "duplicate", run: () => {} },
			]),
		).to.throw();
	});
	it("collects per-system timing only when profiling is enabled", () => {
		const runner = createSystemRunner([{ name: "timed", run: () => {} }], true);
		runner.step(0.5);
		runner.step(0.5);
		const timing = runner.getTimings().get("timed");
		assert(timing !== undefined);
		expect(timing.calls).to.equal(2);
		expect(timing.totalSeconds >= timing.lastSeconds).to.equal(true);
		expect(timing.maxSeconds >= timing.lastSeconds).to.equal(true);
	});
};
