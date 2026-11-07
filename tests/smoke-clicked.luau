local player = game.Players.LocalPlayer
local deadline = os.clock() + 5
local card = player.PlayerGui.ReferenceCounter.Card
repeat task.wait() until card.Count.Text == "2" or os.clock() >= deadline
return {passed = card.Count.Text == "2" and not player:GetAttribute("SmokeClientError"), count = card.Count.Text, error = player:GetAttribute("SmokeClientError")}
