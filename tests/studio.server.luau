local state = require(game.ServerScriptService.TS.ecs.world)
local finished = false
local connection
connection = game.ReplicatedStorage.SmokeResult.OnServerEvent:Connect(function(player)
	local entity = state.playerSessions.getEntity(player)
	assert(entity and state.simulationWorld:has(entity, state.ClientReady), "[Smoke] Missing ready ECS entity")
	assert(state.simulationWorld:get(entity, state.PlayerRef) == player, "[Smoke] Wrong player entity")
	finished = true
	connection:Disconnect()
	print("[Smoke] PASS: real client/server handshake, ECS readiness, and duplicate command handling")
end)
local deadline = os.clock() + 30
repeat task.wait(0.1) until finished or os.clock() > deadline
assert(finished, "[Smoke] Timed out; check client and server Output errors")
