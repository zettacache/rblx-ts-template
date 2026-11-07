"""Translation and parent rotation fixture for Action reuse/retarget checks."""
import bpy
import runpy

runpy.run_path(job['dependencies'][0])
arm = bpy.data.objects['CompanionRig']
for frame, offset in [(1, 0), (9, 0.1), (17, 0), (25, -0.1), (33, 0)]:
    arm.pose.bones['Body'].location.x = offset
    arm.pose.bones['Body'].keyframe_insert(data_path='location', frame=frame)
    root = arm.pose.bones['Root']
    root.rotation_mode = 'XYZ'
    root.rotation_euler.z = offset * 2
    root.location.x = offset * 2
    root.keyframe_insert(data_path='rotation_euler', frame=frame)
    root.keyframe_insert(data_path='location', frame=frame)
bpy.context.scene.frame_set(9)
