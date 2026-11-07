local deadline = os.clock() + 35
repeat task.wait(0.1) until game:GetAttribute("SmokePassed") or game:GetAttribute("SmokeRuntimeError") or os.clock() >= deadline
return {passed = game:GetAttribute("SmokePassed") == true and game:GetAttribute("SmokeRuntimeError") == nil, error = game:GetAttribute("SmokeRuntimeError")}
