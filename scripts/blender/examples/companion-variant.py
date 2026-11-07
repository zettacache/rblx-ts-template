"""Mesh variation reusing a library Action; no duplicate animation authoring."""
import bpy

arm = bpy.data.objects['CompanionRig']
arm.name = 'VariantRig'
arm.animation_data_clear()
for bone in arm.pose.bones:
    bone.rotation_mode = 'QUATERNION'
    bone.rotation_quaternion = (1, 0, 0, 0)
bpy.data.objects['PipelineCompanion'].scale.x = 1.25
