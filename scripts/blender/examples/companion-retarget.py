"""Different bone lengths, rest roll and naming; mesh stays weighted to the rig."""
import bpy
import math
import json
from pathlib import Path

arm = bpy.data.objects['CompanionRig']
arm.name = 'VariantRig'
arm.animation_data_clear()
source_rest = {b.name: [list(row) for row in b.matrix_local.to_3x3()] for b in arm.data.bones}
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
root = arm.data.edit_bones['Root']
root.tail.z = 2
body = arm.data.edit_bones['Body']
body.head.z, body.tail.z = 2, 5
body.roll = math.pi / 2
body.name = 'Torso'
bpy.ops.object.mode_set(mode='OBJECT')
target_rest = {b.name: [list(row) for row in b.matrix_local.to_3x3()] for b in arm.data.bones}
(Path(output_dir) / 'retarget-rest.json').write_text(json.dumps({'source': source_rest, 'target': target_rest}), encoding='utf-8')
mesh = bpy.data.objects['PipelineCompanion']
if 'Body' in mesh.vertex_groups:
    mesh.vertex_groups['Body'].name = 'Torso'
for vertex in mesh.data.vertices:
    vertex.co.z *= 2.5
