-- Runs the built test place's modules under Lune. Live networking is tested in Studio separately.
-- Uses the same approach as roblox-ts/tests/runTestsWithLune.lua (MIT).
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local stdio = require("@lune/stdio")
local task = require("@lune/task")
local game = roblox.deserializePlace(fs.readFile(assert(process.args[1], "Expected a test place path")))

roblox.implementMethod("Instance", "WaitForChild", function(self, name)
	return assert(self:FindFirstChild(name), `Missing test instance {name}`)
end)
roblox.implementMethod("TestService", "Error", function(_, message)
	stdio.ewrite(`{message}\n`)
end)
roblox.implementProperty("RunService", "Heartbeat", function() return {} end, function() end)

local cache = {}
local loading = {}
local moduleRequire
local function execute(sourceScript)
	local environment = table.clone(roblox)
	environment.game = game
	environment.script = sourceScript
	environment.require = moduleRequire
	environment.task = task
	environment.tick = os.clock
	-- Lune has no MicroProfiler. Keep timing tests real while making engine-only markers no-ops.
	environment.debug = table.clone(debug)
	environment.debug.profilebegin = function() end
	environment.debug.profileend = function() end
	return luau.load(sourceScript.Source, {
		debugName = sourceScript:GetFullName(), environment = environment, injectGlobals = true,
	})()
end
function moduleRequire(moduleScript)
	assert(moduleScript:IsA("ModuleScript"), "Expected a ModuleScript")
	local key = moduleScript:GetFullName()
	if cache[key] then return table.unpack(cache[key]) end
	assert(not loading[key], `Circular module import: {key}`)
	loading[key] = true
	local values = table.pack(execute(moduleScript))
	loading[key] = nil
	cache[key] = values
	return table.unpack(values)
end
execute(game:GetService("ServerScriptService").TestRunner)
