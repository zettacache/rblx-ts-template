/// <reference types="@rbxts/testez/globals" />
import { createPlayerSessions } from "shared/ecs/player-sessions";
import { createReferenceCounter } from "shared/ecs/reference-counter";

export = () => {
	function setup() {
		const sessions = createPlayerSessions<string>();
		const counter = createReferenceCounter(sessions);
		const entity = sessions.add("alice");
		sessions.queueReady("alice");
		sessions.step(() => {});
		const values = new Array<number>();
		const publish = (_key: string, count: number) => values.push(count);
		counter.step(publish);
		return { sessions, counter, entity, values, publish };
	}
	it("publishes initial state then applies one bounded command on a tick", () => {
		const { sessions, counter, entity, values, publish } = setup();
		expect(values[0]).to.equal(0);
		expect(counter.queue("alice", 0, 0)).to.equal(true);
		for (let i = 0; i < 100; i++) expect(counter.queue("alice", 0, 1)).to.equal(false);
		expect(counter.pendingCount()).to.equal(1);
		expect(sessions.simulationWorld.get(entity, counter.Count)).to.equal(0);
		counter.step(publish);
		expect(values[1]).to.equal(1);
		expect(counter.queue("alice", 0, 1)).to.equal(false);
		expect(counter.queue("alice", 1, 0.1)).to.equal(false);
		expect(counter.queue("alice", 1, 0.25)).to.equal(true);
	});
	it("rejects invalid revisions, unknown and unready players and caps state", () => {
		const { sessions, counter, entity } = setup();
		for (const value of [-1, 0.5, math.huge, 0 / 0]) expect(counter.queue("alice", value, 1)).to.equal(false);
		expect(counter.queue("unknown", 0, 1)).to.equal(false);
		sessions.add("bob");
		expect(counter.queue("bob", 0, 1)).to.equal(false);
		sessions.simulationWorld.set(entity, counter.Count, 100);
		expect(counter.queue("alice", 100, 1)).to.equal(false);
	});
	it("does not apply an old session's command to a replacement", () => {
		const { sessions, counter, publish, values } = setup();
		counter.queue("alice", 0, 1);
		sessions.remove("alice");
		sessions.add("alice");
		sessions.queueReady("alice");
		sessions.step(() => {});
		counter.step(publish);
		expect(values.size()).to.equal(2);
		expect(values[1]).to.equal(0);
		counter.remove("alice");
		expect(counter.queue("alice", 0, 0)).to.equal(true);
		counter.clear();
		expect(counter.pendingCount()).to.equal(0);
	});
};
