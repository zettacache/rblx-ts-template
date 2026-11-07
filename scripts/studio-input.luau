local Http=game:GetService("HttpService")
local player=game:GetService("Players").LocalPlayer
local function destroy(state)
	if not state then return end
	if state.connection then state.connection:Disconnect();state.connection=nil end
	if state.traceConnection then state.traceConnection:Disconnect();state.traceConnection=nil end
	if state.overlay then state.overlay:Destroy();state.overlay=nil end
end
local function target()
	local current=player
	for name in request.path:gsub("^LocalPlayer%.",""):gmatch("[^.]+") do
		local found
		for _,child in current:GetChildren() do if child.Name==name then assert(not found,"Ambiguous GUI path");found=child end end
		current=assert(found,"GUI target missing: "..request.path)
	end
	assert(current:IsA("GuiButton") and current.Active and current.Interactable,"Target is not an enabled GUI button")
	local low=current.AbsolutePosition;local high=low+current.AbsoluteSize
	local parent=current
	while parent and parent~=player.PlayerGui do
		if parent:IsA("GuiObject") then
			assert(parent.Visible,"GUI target is hidden")
			if parent.ClipsDescendants then
				local p=parent.AbsolutePosition;local q=p+parent.AbsoluteSize
				low=Vector2.new(math.max(low.X,p.X),math.max(low.Y,p.Y))
				high=Vector2.new(math.min(high.X,q.X),math.min(high.Y,q.Y))
			end
		elseif parent:IsA("ScreenGui") then assert(parent.Enabled,"ScreenGui is disabled") end
		parent=parent.Parent
	end
	local size=workspace.CurrentCamera.ViewportSize
	low=Vector2.new(math.max(0,low.X),math.max(0,low.Y));high=Vector2.new(math.min(size.X,high.X),math.min(size.Y,high.Y))
	assert(high.X-low.X>=2 and high.Y-low.Y>=2,"GUI button is clipped or offscreen; scroll it into view")
	local center=(low+high)*.5
	local inset=game:GetService("GuiService"):GetGuiInset()
	return current,{x=center.X,y=center.Y,viewport={size.X,size.Y,inset.X,inset.Y}}
end
local function execute()
	assert(game:GetService("RunService"):IsRunning(),"Input requires Play mode")
	if request.action=="cleanup" then destroy(_G[request.key]);_G[request.key]=nil;return true end
	if request.action=="target" then local _,point=target();return point end
	if request.action=="calibrate" then
		local state={};_G[request.key]=state
		local gui=Instance.new("ScreenGui");state.overlay=gui
		gui.Name=request.key;gui.IgnoreGuiInset=true;gui.ScreenInsets=Enum.ScreenInsets.None
		gui.DisplayOrder=2147483647;gui.ResetOnSpawn=false
		local button=Instance.new("TextButton");button.Name="Calibration";button.Size=UDim2.fromScale(1,1)
		button.BackgroundTransparency=1;button.Text="";button.Modal=true;button.Parent=gui
		state.connection=button.InputBegan:Connect(function(input)
			if input.UserInputType==Enum.UserInputType.MouseButton1 or input.UserInputType==Enum.UserInputType.Touch then
				state.received={x=input.Position.X,y=input.Position.Y,inputType=input.UserInputType.Name}
			end
		end)
		gui.Parent=player.PlayerGui;task.wait(.1)
		local size=workspace.CurrentCamera.ViewportSize;return {x=size.X*.5,y=size.Y*.5}
	end
	if request.action=="measured" then
		local state=assert(_G[request.key]);local received=state.received;destroy(state)
		assert(received,"No native input received by calibration overlay");return received
	end
	if request.action=="arm" then
		local button,point=target();local state={count=0};_G[request.key]=state
		state.connection=button.Activated:Connect(function(input)state.count+=1;state.inputType=input.UserInputType.Name end)
		state.traceConnection=game:GetService("UserInputService").InputBegan:Connect(function(input)
			if input.UserInputType==Enum.UserInputType.Touch or input.UserInputType==Enum.UserInputType.MouseButton1 then
				local hits={};for i,v in player.PlayerGui:GetGuiObjectsAtPosition(input.Position.X,input.Position.Y) do if i>8 then break end;table.insert(hits,v:GetFullName()) end
				state.trace={x=input.Position.X,y=input.Position.Y,hits=hits}
			end
		end)
		return point
	end
	assert(request.action=="activated","Unknown input action")
	local state=assert(_G[request.key]);return {count=state.count,inputType=state.inputType,trace=state.trace}
end
local ok,value=pcall(execute)
return Http:JSONEncode({robloxStudio=1,ok=ok,value=ok and value or nil,error=not ok and tostring(value) or nil})
