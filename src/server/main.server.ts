import { processPlayerSessions, startPlayerSessions } from "server/ecs/systems/player-sessions";
import { createSystemRunner } from "shared/ecs/system-runner";

const RunService = game.GetService("RunService");
const stopPlayerSessions = startPlayerSessions();

// Add systems in execution order. Inspect runner.getTimings() while debugging in Studio.
const runner = createSystemRunner(
	[{ name: "playerSessions", run: processPlayerSessions }],
	RunService.IsStudio(),
);
const heartbeat = RunService.Heartbeat.Connect((deltaTime) => runner.step(deltaTime));

game.BindToClose(() => {
	heartbeat.Disconnect();
	stopPlayerSessions();
});

print("[Game] Jecs simulation and Flamework networking started.");
