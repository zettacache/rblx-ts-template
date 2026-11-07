local smoke = game.ServerScriptService.SmokeTest
local deadline = os.clock() + 5
repeat task.wait() until smoke:GetAttribute("SmokeCounterCount") == 2 or os.clock() >= deadline
return {passed = smoke:GetAttribute("SmokePlayerCount") == 1 and smoke:GetAttribute("SmokeCounterCount") == 2 and not game:GetAttribute("SmokeRuntimeError"), players = smoke:GetAttribute("SmokePlayerCount"), count = smoke:GetAttribute("SmokeCounterCount"), error = game:GetAttribute("SmokeRuntimeError")}
