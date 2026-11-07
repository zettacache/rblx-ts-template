/// <reference types="@rbxts/testez/globals" />
import { createPlayerSessions } from "shared/ecs/player-sessions";

export = () => {
	it("coalesces readiness and applies it once during a step", () => {
		const sessions = createPlayerSessions<string>();
		const entity = sessions.add("alice");
		expect(sessions.add("alice")).to.equal(entity);
		for (let index = 0; index < 100; index++) sessions.queueReady("alice");
		expect(sessions.pendingCount()).to.equal(1);
		expect(sessions.simulationWorld.has(entity, sessions.ClientReady)).to.equal(false);
		let acknowledgements = 0;
		sessions.step(() => acknowledgements++);
		expect(sessions.simulationWorld.has(entity, sessions.ClientReady)).to.equal(true);
		sessions.queueReady("alice");
		sessions.step(() => acknowledgements++);
		expect(acknowledgements).to.equal(1);
	});
	it("drops commands for departed and unknown sessions", () => {
		const sessions = createPlayerSessions<string>();
		const entity = sessions.add("alice");
		sessions.queueReady("alice");
		sessions.remove("alice");
		sessions.queueReady("unknown");
		expect(sessions.pendingCount()).to.equal(0);
		expect(sessions.getEntity("alice")).to.equal(undefined);
		expect(sessions.simulationWorld.contains(entity)).to.equal(false);
		sessions.step(() => error("Departed session acknowledged"));
		const replacement = sessions.add("alice");
		expect(sessions.simulationWorld.has(replacement, sessions.ClientReady)).to.equal(false);
	});
	it("clears all entities and pending commands", () => {
		const sessions = createPlayerSessions<string>();
		const entities = [sessions.add("alice"), sessions.add("bob")];
		sessions.queueReady("bob");
		sessions.clear();
		for (const entity of entities) expect(sessions.simulationWorld.contains(entity)).to.equal(false);
		expect(sessions.pendingCount()).to.equal(0);
	});
};
