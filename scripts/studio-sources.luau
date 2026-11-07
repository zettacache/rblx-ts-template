-- Read-only, bounded source retrieval. No instance writes, cache, or require().
local Http = game:GetService("HttpService")
local Encoding = game:GetService("EncodingService")
local Editor = game:GetService("ScriptEditorService")
local function digest(text)
	local raw = Encoding:ComputeStringHash(text, Enum.HashAlgorithm.Sha256)
	return (string.gsub(raw, ".", function(c) return string.format("%02x", string.byte(c)) end))
end
local function execute()
	assert(tostring(game.PlaceId) == request.placeId, "Wrong place")
	assert(not game:GetService("RunService"):IsRunning(), "Source export requires Edit mode")
	assert(request.sourceMode == "editor" or request.sourceMode == "stored", "Invalid source mode")
	assert(#request.items > 0 and #request.items <= 16, "Request must contain 1..16 paths")
	local budget = 0
	for _, item in request.items do
		assert(item.offset >= 0 and item.offset % 1 == 0, "Invalid offset")
		assert(item.length >= 1 and item.length % 1 == 0, "Invalid length")
		budget += item.length
	end
	assert(budget <= 24000, "Source packet exceeds byte budget")
	local results = {}
	for _, item in request.items do
		local ok, result = pcall(function()
			local instance = game
			for _, segment in item.segments do
				local found = nil
				for _, child in instance:GetChildren() do
					if child.Name == segment then
						assert(not found, "Ambiguous path segment: " .. segment)
						found = child
					end
				end
				instance = assert(found, "Missing path segment: " .. segment)
			end
			assert(instance:IsA("LuaSourceContainer"), "Target is not a script")
			local stored = instance.Source
			local source = if request.sourceMode == "editor" then Editor:GetEditorSource(instance) else stored
			assert(#source <= 1048576, "Source exceeds 1 MiB export limit; use targeted native reads")
			assert(item.offset <= #source, "Source shrank during transfer")
			local hash = digest(source)
			assert(not item.sha256 or item.sha256 == hash, "Source changed during transfer; fetch again")
			local chunk = string.sub(source, item.offset + 1, item.offset + item.length)
			return { ok = true, segments = item.segments, className = instance.ClassName,
				sourceMode = request.sourceMode, differsFromStored = source ~= stored,
				bytes = #source, sha256 = hash, offset = item.offset,
				data = buffer.tostring(Encoding:Base64Encode(buffer.fromstring(chunk))) }
		end)
		if not ok then result = { ok = false, segments = item.segments, error = tostring(result) } end
		table.insert(results, result)
	end
	return { robloxStudio = 1, ok = true, placeId = tostring(game.PlaceId), items = results }
end
local ok, result = pcall(execute)
return Http:JSONEncode(if ok then result else { robloxStudio = 1, ok = false, error = tostring(result) })
