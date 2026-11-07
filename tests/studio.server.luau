local state = require(game.ServerScriptService.TS.ecs.world)
local counter = require(game.ServerScriptService.TS.ecs.systems["reference-counter"]).referenceCounter
game:SetAttribute("SmokeRuntimeError", nil)
game:GetService("LogService").MessageOut:Connect(function(message, kind)
	if kind == Enum.MessageType.MessageError then game:SetAttribute("SmokeRuntimeError", message) end
end)
-- Observe from the same runtime context as the game. External probes read this
-- measurement instead of requiring stateful modules in a tooling context.
game:GetService("RunService").Heartbeat:Connect(function()
	local players = game.Players:GetPlayers()
	script:SetAttribute("SmokePlayerCount", #players)
	local entity = #players == 1 and state.playerSessions.getEntity(players[1])
	script:SetAttribute("SmokeCounterCount", entity and state.simulationWorld:get(entity, counter.Count) or nil)
end)
local finished = false
local connection
connection = game.ReplicatedStorage.SmokeResult.OnServerEvent:Connect(function(player)
	local entity = state.playerSessions.getEntity(player)
	assert(entity and state.simulationWorld:has(entity, state.ClientReady), "[Smoke] Missing ready ECS entity")
	assert(state.simulationWorld:get(entity, state.PlayerRef) == player, "[Smoke] Wrong player entity")
	finished = true
	assert(state.simulationWorld:get(entity, counter.Count) == 1, "[Smoke] Counter did not apply exactly once")
	game:SetAttribute("SmokePassed", true)
	connection:Disconnect()
	print("[Smoke] PASS: real client/server handshake, ECS readiness, and duplicate command handling")
end)
local deadline = os.clock() + 30
repeat task.wait(0.1) until finished or os.clock() > deadline
assert(finished, "[Smoke] Timed out; check client and server Output errors")
