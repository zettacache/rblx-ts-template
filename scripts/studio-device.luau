local Http=game:GetService("HttpService")
local simulator=game:GetService("StudioDeviceSimulatorService")
local function snapshot()
	local result={id=simulator:GetDeviceAsync(),orientation=simulator:GetOrientationAsync().Name}
	if result.id~="default" then
		local size=simulator:GetResolutionAsync()
		result.resolution={size.X,size.Y};result.dpi=simulator:GetPixelDensityAsync()
		result.scaling=simulator:GetScalingModeAsync().Name
	end
	return result
end
local function execute()
	assert(not game:GetService("RunService"):IsRunning(),"Simulator changes require Edit mode")
	if request.action=="snapshot" then return snapshot() end
	local value=request.value
	if request.action=="configure" then
		local id=value.id
		if value.name then
			for _,candidate in simulator:GetDeviceListAsync() do
				if simulator:GetDeviceInfoAsync(candidate).Name==value.name then
					assert(not id,"Ambiguous simulator device name");id=candidate
				end
			end
		end
		assert(id,"Simulator device not found")
		if id=="default" then simulator:StopSimulationAsync()
		else
			simulator:SetDeviceAsync(id)
			if value.orientation then simulator:SetOrientationAsync(Enum.ScreenOrientation[value.orientation]) end
		end
		local observed=snapshot()
		assert(observed.id==id and (not value.orientation or observed.orientation==value.orientation),"Simulator setup verification failed")
		return observed
	end
	assert(request.action=="restore","Unknown simulator action")
	if value.id=="default" then
		-- Orientation setters fail after returning to desktop. Restore it while
		-- the mobile device is still selected, then leave simulation.
		if simulator:GetDeviceAsync()~="default" then
			if simulator:GetOrientationAsync().Name~=value.orientation then simulator:SetOrientationAsync(Enum.ScreenOrientation[value.orientation]) end
			simulator:StopSimulationAsync()
		end
	else
		simulator:SetDeviceAsync(value.id)
		simulator:SetOrientationAsync(Enum.ScreenOrientation[value.orientation])
		simulator:SetResolutionAsync(unpack(value.resolution))
		simulator:SetPixelDensityAsync(value.dpi)
		simulator:SetScalingModeAsync(Enum.DeviceSimulatorScalingMode[value.scaling])
	end
	local observed=snapshot()
	assert(observed.id==value.id and observed.orientation==value.orientation,"Simulator restore verification failed")
	if value.id~="default" then
		assert(observed.resolution[1]==value.resolution[1] and observed.resolution[2]==value.resolution[2]
			and observed.dpi==value.dpi and observed.scaling==value.scaling,"Simulator settings were not restored")
	end
	return observed
end
local ok,value=pcall(execute)
return Http:JSONEncode({robloxStudio=1,ok=ok,value=ok and value or nil,error=not ok and tostring(value) or nil})
