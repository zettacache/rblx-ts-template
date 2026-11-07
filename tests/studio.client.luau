local Players = game:GetService("Players")
local playerScripts = Players.LocalPlayer:WaitForChild("PlayerScripts")
local main = playerScripts:WaitForChild("TS"):WaitForChild("main")
local deadline = os.clock() + 20
repeat task.wait() until main:GetAttribute("HandshakeSucceeded") or os.clock() > deadline
assert(main:GetAttribute("HandshakeSucceeded"), "[Smoke] Client handshake timed out")

local ClientEvents = require(playerScripts.TS.networking).ClientEvents
local protocol = require(game.ReplicatedStorage.TS.networking).NETWORK_PROTOCOL_VERSION
local extraAcknowledgements = 0
local connection = ClientEvents.sessionReady:connect(function() extraAcknowledgements += 1 end)
for _ = 1, 100 do ClientEvents.clientReady:fire(protocol) end
ClientEvents.clientReady:fire(protocol + 1)
task.wait(1)
connection:Disconnect()
assert(extraAcknowledgements == 0, "[Smoke] Duplicate command was acknowledged")
game.ReplicatedStorage.SmokeResult:FireServer()
