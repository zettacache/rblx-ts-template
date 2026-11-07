"""Small weighted two-bone fixture for validating the asset pipeline, not game art."""
import bpy
import math
bpy.ops.object.armature_add()
arm = bpy.context.object
arm.name = 'CompanionRig'
bpy.ops.object.mode_set(mode='EDIT')
root = arm.data.edit_bones[0]
root.name = 'Root'
root.head, root.tail = (0, 0, 0), (0, 0, 1)
body = arm.data.edit_bones.new('Body')
body.head, body.tail, body.parent = (0, 0, 1), (0, 0, 2), root
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(0, 0, 1.5))
mesh = bpy.context.object
mesh.name = 'PipelineCompanion'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
group = mesh.vertex_groups.new(name='Body')
group.add(list(range(len(mesh.data.vertices))), 1, 'REPLACE')
modifier = mesh.modifiers.new('Rig', 'ARMATURE')
modifier.object = arm
mesh.parent = arm
material = bpy.data.materials.new('Jade')
material.diffuse_color = (0.08, 0.55, 0.3, 1)
material.use_nodes = True
material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.55, 0.3, 1)
mesh.data.materials.append(material)
bone = arm.pose.bones['Body']
bone.rotation_mode = 'XYZ'
for frame, angle in [(1, 0), (9, 0.35), (17, 0), (25, -0.35), (33, 0)]:
    bone.rotation_euler[1] = angle
    bone.keyframe_insert(data_path='rotation_euler', frame=frame)
bpy.context.scene.frame_set(9)
