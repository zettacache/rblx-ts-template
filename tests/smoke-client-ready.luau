local player = game.Players.LocalPlayer
local card = player.PlayerGui.ReferenceCounter.Card
local viewport = workspace.CurrentCamera.ViewportSize
return {passed = card.Count.Text == "1" and card.Increment.Active and not player:GetAttribute("SmokeClientError"), viewport = {viewport.X, viewport.Y}, error = player:GetAttribute("SmokeClientError")}
