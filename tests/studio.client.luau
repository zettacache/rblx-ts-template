local Players = game:GetService("Players")
local runtimeError
game:GetService("LogService").MessageOut:Connect(function(message, kind)
	if kind == Enum.MessageType.MessageError then
		runtimeError = message
		Players.LocalPlayer:SetAttribute("SmokeClientError", message)
	end
end)
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
local playerGui = Players.LocalPlayer:WaitForChild("PlayerGui")
local card = playerGui:WaitForChild("ReferenceCounter", 5):WaitForChild("Card", 5)
assert(card.Count.Text == "0", "[Smoke] Missing initial snapshot")
for _ = 1, 100 do ClientEvents.incrementCounter:fire(protocol, 0) end
task.wait(0.5)
assert(card.Count.Text == "1", "[Smoke] Duplicate increments applied or snapshot missing")
ClientEvents.incrementCounter:fire(protocol + 1, 1)
ClientEvents.incrementCounter:fire(protocol, 0)
ClientEvents.incrementCounter:fire(protocol, -1)
ClientEvents.incrementCounter:fire(protocol, 0.5)
task.wait(0.5)
assert(card.Count.Text == "1", "[Smoke] Invalid increment applied")
assert(not runtimeError, runtimeError)
game.ReplicatedStorage.SmokeResult:FireServer()
