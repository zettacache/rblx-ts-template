-- Detached export; previews touch only a temporary clone, cleaned even on failure.
local Http = game:GetService("HttpService")
local disposable = {}
local function owned(instance)
    table.insert(disposable, instance)
    return instance
end
local function resolve(path)
    local current = game
    for segment in string.gmatch(path, "[^.]+") do
        local found
        for _, child in current:GetChildren() do
            if child.Name == segment then assert(not found, "Ambiguous rig path"); found = child end
        end
        current = assert(found, "Missing rig path: " .. segment)
    end
    assert(current:IsA("Model"), "Rig must be a Model")
    return current
end
local function rigInfo(model)
    local joints, bones = {}, {}
    for _, obj in model:GetDescendants() do
        if obj:IsA("Motor6D") then
            assert(obj.Part0 and obj.Part1, "Disconnected Motor6D: " .. obj.Name)
            table.insert(joints, {name=obj.Name, part0=obj.Part0.Name, part1=obj.Part1.Name, c0={obj.C0:GetComponents()}, c1={obj.C1:GetComponents()}})
        elseif obj:IsA("Bone") then
            table.insert(bones, {name=obj.Name, parent=obj.Parent.Name, rest={obj.CFrame:GetComponents()}})
        end
    end
    return {joints=joints, bones=bones}
end
local function execute()
    assert(not game:GetService("RunService"):IsRunning(), "Animation tooling requires Edit mode")
    assert(tostring(game.PlaceId) == request.placeId, "Wrong place")
    if request.action == "rig" then return {robloxStudio=1,ok=true,rig=rigInfo(resolve(request.rig))} end
    local clip = request.clip
    local sequence = owned(Instance.new("KeyframeSequence"))
    sequence.Name, sequence.Loop, sequence.Priority = clip.name, clip.loop, Enum.AnimationPriority[clip.priority]
    for _, frame in clip.keyframes do
        local key = Instance.new("Keyframe")
        key.Time = frame.time
        key.Parent = sequence
        local poses = {}
        for _, channel in clip.channels do
            local pose = Instance.new("Pose")
            pose.Name = channel.name
            pose.CFrame = CFrame.new(table.unpack(frame.poses[channel.name]))
            pose.Weight = 1
            pose.EasingStyle = Enum.PoseEasingStyle.Linear
            pose.EasingDirection = Enum.PoseEasingDirection.In
            pose.Parent = channel.parent and poses[channel.parent] or key
            poses[channel.name] = pose
        end
        for _, marker in frame.markers do
            local item = Instance.new("KeyframeMarker")
            item.Name, item.Value, item.Parent = marker.name, marker.value, key
        end
    end
    local serializer = game:GetService("SerializationService")
    local data = serializer:SerializeInstancesAsync({sequence})
    assert(buffer.len(data) <= 1024 * 1024, "Native animation exceeds transfer limit")
    local roundtrip = serializer:DeserializeInstancesAsync(data)
    assert(#roundtrip == 1 and roundtrip[1]:IsA("KeyframeSequence"), "Wrong animation root")
    local copy = owned(roundtrip[1])
    assert(copy.Name == clip.name and copy.Loop == clip.loop and copy.Priority == sequence.Priority, "Clip metadata mismatch")
    local keys = copy:GetKeyframes()
    table.sort(keys, function(a,b) return a.Time < b.Time end)
    assert(#keys == #clip.keyframes, "Lost keyframes")
    for i, key in keys do
        local frame, poses = clip.keyframes[i], {}
        assert(math.abs(key.Time - frame.time) < 0.00001, "Frame time mismatch")
        if i > 1 then assert(key.Time > keys[i-1].Time, "Serialized keyframe times collapsed") end
        for _, obj in key:GetDescendants() do if obj:IsA("Pose") then poses[obj.Name] = obj end end
        for _, c in clip.channels do
            local p = assert(poses[c.name], "Lost pose")
            assert(p.Parent == (c.parent and poses[c.parent] or key), "Pose hierarchy mismatch")
            assert(p.Weight == 1 and p.EasingStyle == Enum.PoseEasingStyle.Linear and p.EasingDirection == Enum.PoseEasingDirection.In, "Pose interpolation mismatch")
            local values = {p.CFrame:GetComponents()}
            for n, v in values do assert(math.abs(v - frame.poses[c.name][n]) < 0.0001, "Pose transform mismatch") end
        end
        local markers = key:GetMarkers()
        assert(#markers == #frame.markers, "Lost markers")
        for n, m in markers do assert(m.Name == frame.markers[n].name and m.Value == frame.markers[n].value, "Marker mismatch") end
    end
    if request.action == "export" then
        local encoding = game:GetService("EncodingService")
        local raw = encoding:ComputeStringHash(buffer.tostring(data), Enum.HashAlgorithm.Sha256)
        local hash = string.gsub(raw, ".", function(c) return string.format("%02x", string.byte(c)) end)
        return {robloxStudio=1,ok=true,native=true,verified=true,frames=#keys,base64=buffer.tostring(encoding:Base64Encode(data)),sha256=hash}
    end
    assert(request.action == "preview", "Unknown animation operation")
    local model
    if request.rig then
        local source = resolve(request.rig)
        assert(source.Archivable, "Rig is not archivable")
        model = owned(assert(source:Clone(), "Cannot clone rig"))
        for _, obj in model:GetDescendants() do
            if obj:IsA("LuaSourceContainer") then obj:Destroy()
            elseif obj:IsA("Animator") then obj:Destroy() end
        end
    else
        model = owned(Instance.new("Model"))
        local parts = {}
        for _, c in clip.channels do
            if request.rigKind == "bone" and c.parent then
                local bone = Instance.new("Bone")
                bone.Name, bone.Parent = c.name, parts[c.parent]
                parts[c.name] = bone
                continue
            end
            local part = Instance.new("Part")
            part.Name, part.Size, part.Anchored, part.CanCollide = c.name, Vector3.one, not c.parent, false
            part.Parent = model
            parts[c.name] = part
            if c.parent then
                local motor = Instance.new("Motor6D")
                motor.Name, motor.Part0, motor.Part1 = c.name, parts[c.parent], part
                motor.C0 = CFrame.new(0, 2, 0)
                motor.Parent = part
            end
        end
    end
    model.Name = "__AnimationPreview_" .. Http:GenerateGUID(false)
    local targets, parents = {}, {}
    for _, obj in model:GetDescendants() do
        if obj:IsA("BasePart") then obj.CanCollide=false; obj.CanTouch=false; obj.CanQuery=false end
        local name, parent
        if obj:IsA("Motor6D") then
            assert(obj.Part0 and obj.Part1, "Disconnected motor")
            name, parent = obj.Part1.Name, obj.Part0.Name
        elseif obj:IsA("Bone") then name, parent = obj.Name, obj.Parent.Name end
        if name then
            assert(not targets[name], "Ambiguous animated target: " .. name)
            targets[name], parents[name] = obj, parent
        end
    end
    for _, c in clip.channels do
        if c.parent then assert(targets[c.name] and parents[c.name] == c.parent, "Rig hierarchy mismatch: " .. c.name) end
    end
    local controller = model:FindFirstChildWhichIsA("Humanoid", true) or model:FindFirstChildWhichIsA("AnimationController", true)
    if not controller then controller=Instance.new("AnimationController"); controller.Parent=model end
    local animator = Instance.new("Animator")
    animator.Parent = controller
    model.Parent = workspace
    -- Keep preview geometry away from authored scenery; original rig is untouched.
    model:PivotTo(CFrame.new(0, 10000, 0))
    local anim = owned(Instance.new("Animation"))
    anim.AnimationId = game:GetService("AnimationClipProvider"):RegisterAnimationClip(copy)
    local track = owned(animator:LoadAnimation(anim))
    track.Looped=false
    track:Play(0, 1, 0)
    local deadline = os.clock()+5
    while track.Length == 0 and os.clock() < deadline do task.wait(0.05) end
    assert(track.Length > 0, "Animation did not load")
    local samples, moved = {}, false
    for _, fraction in {0, 0.25, 0.5, 0.75} do
        local frame = clip.keyframes[math.floor((#clip.keyframes-1)*fraction)+1]
        local time = frame.time
        track.TimePosition = time
        animator:StepAnimations(0.001)
        local transforms, maxError = {}, 0
        for targetName, obj in targets do
            transforms[targetName] = {obj.Transform:GetComponents()}
            local expected = frame.poses[targetName]
            if expected then
                for i, value in transforms[targetName] do maxError = math.max(maxError, math.abs(value - expected[i])) end
                if obj.Transform ~= CFrame.identity then moved = true end
            end
        end
        assert(maxError < 0.002, "Animator pose mismatch at " .. time .. ": " .. maxError)
        table.insert(samples, {time=time,transforms=transforms,maxError=maxError})
    end
    track:Stop(0)
    return {robloxStudio=1,ok=true,native=true,verified=true,previewMatches=true,syntheticRig=not request.rig,rigKind=request.rig and "clone" or request.rigKind,length=track.Length,movementObserved=moved,samples=samples,cleanup="temporary rig destroyed"}
end
local success, result = pcall(execute)
for i = #disposable, 1, -1 do disposable[i]:Destroy() end
if not success then return Http:JSONEncode({robloxStudio=1,ok=false,error=tostring(result)}) end
return Http:JSONEncode(result)
