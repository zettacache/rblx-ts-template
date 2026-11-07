-- request is supplied as JSON data by studio-author.cjs, never as source code.
local Http = game:GetService("HttpService")
local Editor = game:GetService("ScriptEditorService")
local History = game:GetService("ChangeHistoryService")
local function resolve(path)
	local current = game
	for name in string.gmatch(path, "[^.]+") do
		local found = nil
		for _, child in current:GetChildren() do
			if child.Name == name then
				assert(found == nil, "Ambiguous instance name: " .. path)
				found = child
			end
		end
		if not found then return nil end
		current = found
	end
	return current
end
local function unpackValue(v)
	if type(v) ~= "table" then return v end
	if v.type == "Enum" then return Enum[v.enum][v.name] end
	local constructors = { Vector3 = Vector3.new, Vector2 = Vector2.new, Color3 = Color3.new,
		CFrame = CFrame.new, UDim = UDim.new, UDim2 = UDim2.new }
	return constructors[v.type](table.unpack(v.value))
end
local function packValue(v)
	local t = typeof(v)
	if t == "string" or t == "number" or t == "boolean" then return v end
	if t == "EnumItem" then return { type = "Enum", enum = string.gsub(tostring(v.EnumType), "^Enum%.", ""), name = v.Name } end
	if t == "Vector3" then return { type = t, value = { v.X, v.Y, v.Z } } end
	if t == "Vector2" then return { type = t, value = { v.X, v.Y } } end
	if t == "Color3" then return { type = t, value = { v.R, v.G, v.B } } end
	if t == "CFrame" then return { type = t, value = { v:GetComponents() } } end
	if t == "UDim" then return { type = t, value = { v.Scale, v.Offset } } end
	if t == "UDim2" then return { type = t, value = { v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset } } end
	error("Property type is not supported: " .. t)
end
local function equal(a, b)
	if type(a) ~= type(b) then return false end
	if type(a) ~= "table" then return a == b end
	for key, val in a do if not equal(val, b[key]) then return false end end
	for key in b do if a[key] == nil then return false end end
	return true
end
local function propertyEqual(a, b)
	-- BasePart colors are stored with 8-bit channel precision.
	if type(a) == "table" and type(b) == "table" and a.type == "Color3" and b.type == "Color3" then
		for i = 1, 3 do if math.abs(a.value[i] - b.value[i]) > 1 / 255 + 0.000001 then return false end end
		return true
	end
	return equal(a, b)
end
local function snapshot(plan)
	local before, creates = {}, {}
	for _, op in plan.operations do
		local target = resolve(op.path)
		if op.op == "create" then
			assert(not target, "Create target already exists: " .. op.path)
			local parentPath = string.match(op.path, "^(.*)%.[^.]+$")
			assert(resolve(parentPath) or creates[parentPath], "Missing parent: " .. parentPath)
			creates[op.path] = true
			table.insert(before, { exists = false })
		else
			assert(target, "Missing target: " .. op.path)
			local values = {}
			for key in op.properties do values[key] = packValue(target[key]) end
			local entry = { exists = true, className = target.ClassName, properties = values }
			if op.op == "script" then
				assert(target:IsA("LuaSourceContainer"), "Target is not a script")
				entry.source = Editor:GetEditorSource(target)
			end
			table.insert(before, entry)
		end
	end
	return before
end
local function execute()
	assert(not game:GetService("RunService"):IsRunning(), "Authoring requires Edit mode; stop the playtest first")
	local plan = request.plan
	local before = snapshot(plan)
	if request.action == "inspect" then
		return { robloxStudio = 1, ok = true, placeId = tostring(game.PlaceId), before = before }
	end
	assert(request.action == "apply", "Unknown action")
	assert(tostring(game.PlaceId) == request.placeId, "Place changed; inspect again")
	assert(equal(before, request.before), "Target changed since inspection; inspect again")
	-- execute_luau in Roblox's bridge already owns an Assistant Undo recording.
	-- Never cancel someone else's recording; restore only this plan on failure.
	local bridgeRecording = History:IsRecordingInProgress()
	local recording = if bridgeRecording then nil else History:TryBeginRecording("RobloxToolsAuthor", plan.name)
	assert(bridgeRecording or recording, "Cannot begin Undo recording")
	local changed, touched = {}, {}
	local ok, err = pcall(function()
		for index, op in plan.operations do
			local target = resolve(op.path)
			if op.op == "create" then
				assert(not target, "Create target changed")
				local parentPath, name = string.match(op.path, "^(.*)%.([^.]+)$")
				local parent = assert(resolve(parentPath), "Parent disappeared")
				target = Instance.new(op.className)
				target.Name = name
				-- Parent immediately so ChangeHistory tracks subsequent writes.
				target.Parent = parent
			end
			assert(target, "Target disappeared")
			table.insert(touched, { target = target, op = op, index = index })
			if op.source ~= nil then
				local expected = if op.op == "create" then "" else before[index].source
				Editor:UpdateSourceAsync(target, function(current)
					assert(current == expected, "Script changed while applying: " .. op.path)
					return op.source
				end)
				assert(Editor:GetEditorSource(target) == op.source, "Script verification failed")
			end
			for key, value in op.properties do target[key] = unpackValue(value) end
			for key, value in op.properties do
				assert(propertyEqual(packValue(target[key]), packValue(unpackValue(value))), "Property verification failed: " .. key)
			end
			table.insert(changed, op.path)
		end
	end)
	if not ok then
		local cancelled, cancelError = pcall(function()
			if recording then
				History:FinishRecording(recording, Enum.FinishRecordingOperation.Cancel)
			else
				for i = #touched, 1, -1 do
					local item = touched[i]
					if item.op.op == "create" then
						item.target:Destroy()
					else
						local previous = before[item.index]
						for key, value in previous.properties do
							local current = packValue(item.target[key])
							assert(equal(current, value) or propertyEqual(current, packValue(unpackValue(item.op.properties[key]))), "Concurrent property edit during rollback")
							item.target[key] = unpackValue(value)
						end
						if previous.source ~= nil then
							Editor:UpdateSourceAsync(item.target, function(current)
								assert(current == previous.source or current == item.op.source, "Concurrent script edit during rollback")
								return previous.source
							end)
						end
					end
				end
			end
		end)
		local restored, restoredState = pcall(function() return snapshot(plan) end)
		local verified = cancelled and restored and equal(restoredState, before)
		error(tostring(err) .. (if verified then " (rollback verified)" else " (ROLLBACK UNCONFIRMED: " .. tostring(cancelError) .. ")"))
	end
	if recording then History:FinishRecording(recording, Enum.FinishRecordingOperation.Commit) end
	return { robloxStudio = 1, ok = true, placeId = tostring(game.PlaceId), changed = changed,
		undoMode = if bridgeRecording then "bridge" else "own", captureRequired = true }
end
local ok, result = pcall(execute)
if not ok then result = { robloxStudio = 1, ok = false, error = tostring(result) } end
return Http:JSONEncode(result)
