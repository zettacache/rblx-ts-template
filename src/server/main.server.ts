import { processPlayerSessions, startPlayerSessions } from "server/ecs/systems/player-sessions";
import { createSystemRunner } from "shared/ecs/system-runner";
import { processReferenceCounter, startReferenceCounter } from "server/ecs/systems/reference-counter";

const RunService = game.GetService("RunService");
const stopPlayerSessions = startPlayerSessions();
const stopReferenceCounter = startReferenceCounter();

// Add systems in execution order. Inspect runner.getTimings() while debugging in Studio.
const runner = createSystemRunner(
	[
		{ name: "playerSessions", run: processPlayerSessions },
		{ name: "referenceCounter", run: processReferenceCounter },
	],
	RunService.IsStudio(),
);
const heartbeat = RunService.Heartbeat.Connect((deltaTime) => runner.step(deltaTime));

game.BindToClose(() => {
	heartbeat.Disconnect();
	stopReferenceCounter();
	stopPlayerSessions();
});

print("[Game] Jecs simulation and Flamework networking started.");
