"""Headless job wrapper; never attaches to an interactive Blender process."""
import bpy
import sys
import json
import math
import runpy
import time
from pathlib import Path
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:]
job = json.loads(Path(args[0]).read_text(encoding='utf-8'))
output = Path(args[1])
started = time.perf_counter()
timings = {}
phase_started = started
def phase(name):
    global phase_started
    now = time.perf_counter()
    timings[name] = (now - phase_started) * 1000
    phase_started = now
if job.get('blend'):
    bpy.ops.wm.open_mainfile(filepath=job['blend'], load_ui=False, use_scripts=False)
    if bpy.data.libraries:
        raise ValueError('Make linked libraries local before submitting a frozen blend input')
    for image in bpy.data.images:
        if image.source in {'FILE', 'TILED', 'MOVIE', 'SEQUENCE'} and not image.packed_file:
            raise ValueError('Pack external image resources into the input blend first: ' + image.name)
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
if job.get('script'):
    runpy.run_path(job['script'], init_globals={'output_dir': str(output), 'job': job})
if bpy.data.libraries:
    raise ValueError('Linked library exports are not supported; make objects local')
for image in bpy.data.images:
    if image.source in {'MOVIE', 'SEQUENCE', 'TILED'}:
        raise ValueError('Only still single-tile texture images are supported: ' + image.name)
    if image.source == 'FILE' and not image.packed_file:
        if not Path(bpy.path.abspath(image.filepath)).is_file():
            raise ValueError('Missing texture: ' + image.name)
        image.pack()
    elif image.source == 'GENERATED' and not image.packed_file:
        image.pack()
scene = bpy.context.scene
phase('sceneBuildMs')
meshes = [o for o in scene.objects if o.type == 'MESH']
if not meshes:
    raise ValueError('Job produced no mesh objects')
stats = []
deps = bpy.context.evaluated_depsgraph_get()
for obj in meshes:
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    stats.append({'name': obj.name, 'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles)})
    if not mesh.vertices or not mesh.loop_triangles:
        raise ValueError('Empty mesh: ' + obj.name)
    if any(not math.isfinite(v) for vertex in mesh.vertices for v in vertex.co):
        raise ValueError('Nonfinite geometry: ' + obj.name)
    evaluated.to_mesh_clear()

phase('geometryValidationMs')
if job.get('animation'):
    config = job['animation']
    arm = bpy.data.objects.get(config['armature'])
    if arm is None or arm.type != 'ARMATURE':
        raise ValueError('Named armature is missing')
    if any(abs(arm.matrix_world[i][j] - Matrix.Identity(4)[i][j]) > 1e-5 for i in range(4) for j in range(4)):
        raise ValueError('Apply armature object transforms before animation export')
    if len(arm.data.bones) > 99:
        raise ValueError('Animation supports at most 99 bones plus the root part')
    if config['rootPart'] in arm.data.bones:
        raise ValueError('rootPart must be distinct from all bone names')
    # Blender X,Y,Z -> Roblox X,Z,-Y. Pose transforms are relative to rest,
    # conjugated into the same basis; no Euler-angle approximations.
    basis = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    channels = [{'name': config['rootPart'], 'parent': None}] + [{'name': b.name, 'parent': b.parent.name if b.parent else config['rootPart']} for b in arm.data.bones]
    frames = []
    original_frame = scene.frame_current
    scene.render.fps = config['fps']
    scene.render.fps_base = 1
    scene.frame_start, scene.frame_end = config['start'], config['end']
    for frame in range(config['start'], config['end'] + 1):
        scene.frame_set(frame)
        poses = {config['rootPart']: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]}
        evaluated = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        for bone in arm.data.bones:
            pose = evaluated.pose.bones[bone.name]
            rest = bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local
            posed = pose.parent.matrix.inverted() @ pose.matrix if pose.parent else pose.matrix
            delta = basis @ (rest.inverted() @ posed) @ basis.inverted()
            rot = delta.to_3x3()
            if abs(rot.determinant() - 1) > 1e-4 or any(abs((rot.transposed() @ rot)[i][j] - (1 if i == j else 0)) > 1e-4 for i in range(3) for j in range(3)):
                raise ValueError('Animated scale/shear cannot be represented by Roblox CFrame: ' + bone.name)
            t = delta.translation * config.get('studsPerUnit', 1)
            poses[bone.name] = list(t) + [rot[i][j] for i in range(3) for j in range(3)]
        frames.append({'time': (frame - config['start']) / config['fps'], 'poses': poses})
    scene.frame_set(original_frame)
    clip = {'version': 1, 'name': job['name'], 'loop': config.get('loop', True), 'priority': 'Idle', 'channels': channels, 'keyframes': frames}
    (output / 'animation.json').write_text(json.dumps(clip, indent=2), encoding='utf-8')

phase('animationSampleMs')
# Save before adding review cameras/lights; blend is the reusable source scene.
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'scene.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type in {'MESH', 'ARMATURE', 'EMPTY'}:
        obj.select_set(True)
if 'fbx' in job['formats']:
    bpy.ops.export_scene.fbx(filepath=str(output / 'model.fbx'), use_selection=True, object_types={'MESH', 'ARMATURE', 'EMPTY'}, add_leaf_bones=False, axis_forward='-Z', axis_up='Y', path_mode='COPY', embed_textures=True, bake_anim=bool(job.get('animation')), bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_simplify_factor=0)
if 'glb' in job['formats']:
    bpy.ops.export_scene.gltf(filepath=str(output / 'model.glb'), export_format='GLB', use_selection=True, export_animations=bool(job.get('animation')))
phase('saveAndExportMs')

points = []
review_frames = [scene.frame_current]
if job.get('animation'):
    review_frames += [round(config['start'] + (config['end'] - config['start']) * i / 4) for i in range(4)]
saved_frame = scene.frame_current
for review_frame in review_frames:
    scene.frame_set(review_frame)
    for obj in meshes:
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points += [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
scene.frame_set(saved_frame)
lo = Vector([min(p[i] for p in points) for i in range(3)])
hi = Vector([max(p[i] for p in points) for i in range(3)])
center, radius = (lo + hi) / 2, max((hi - lo).length / 2, 0.5)
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = job.get('renderSamples', 24)
scene.render.resolution_x = scene.render.resolution_y = job['size']
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('PipelineReviewWorld')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.12, 0.14, 0.18, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
for i, direction in enumerate([(1, -2, 3), (-2, 1, 2)]):
    data = bpy.data.lights.new('PipelineLight' + str(i), 'AREA')
    data.energy, data.shape, data.size = 300 * radius * radius, 'DISK', radius * 2
    light = bpy.data.objects.new(data.name, data)
    scene.collection.objects.link(light)
    light.location = center + Vector(direction).normalized() * radius * 3
    light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('PipelineCamera')
camera = bpy.data.objects.new('PipelineCamera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type, camera_data.ortho_scale = 'ORTHO', radius * 2.4
camera_data.clip_end = radius * 20 + 100
directions = {'front': (0, -1, 0), 'back': (0, 1, 0), 'left': (-1, 0, 0), 'right': (1, 0, 0), 'top': (0, 0, 1), 'iso': (1, -1, 0.7)}
phase('reviewSetupMs')
for view in job['views']:
    camera.location = center + Vector(directions[view]).normalized() * radius * 4
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(output / (view + '.png'))
    bpy.ops.render.render(write_still=True)
phase('staticRenderMs')
if job.get('animation'):
    camera.location = center + Vector(directions['iso']).normalized() * radius * 4
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    for i, frame in enumerate(review_frames[1:]):
        scene.frame_set(frame)
        scene.render.filepath = str(output / ('motion-' + str(i) + '.png'))
        bpy.ops.render.render(write_still=True)
phase('motionRenderMs')
timings['workerTotalMs'] = (time.perf_counter() - started) * 1000
(output / 'report.json').write_text(json.dumps({'ok': True, 'blender': bpy.app.version_string, 'reviewProfile': job.get('reviewProfile', 'full'), 'renderSamples': scene.cycles.samples, 'timings': timings, 'meshes': stats, 'bounds': [list(lo), list(hi)], 'animationFrames': len(frames) if job.get('animation') else 0}, indent=2), encoding='utf-8')
