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
animation_reuse = None
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
    if config.get('library'):
        library = config['library']
        with bpy.data.libraries.load(library['blend'], link=False) as (available, requested):
            if library['armature'] not in available.objects:
                raise ValueError('Animation library armature is missing')
            requested.objects = [library['armature']]
        source = requested.objects[0]
        # Appending retains weak library bookkeeping even when all IDs are local.
        users = bpy.data.user_map()
        for dependency in list(bpy.data.libraries):
            if not users.get(dependency):
                bpy.data.libraries.remove(dependency)
        if bpy.data.libraries:
            raise ValueError('Make animation library dependencies local before reuse')
        if source.type != 'ARMATURE' or not source.animation_data or not source.animation_data.action:
            raise ValueError('Animation library needs an armature with an active Action')
        action = source.animation_data.action
        if set(source.data.bones.keys()) != set(arm.data.bones.keys()):
            raise ValueError('Reusable animation requires identical bone names')
        for rig in (source, arm):
            if rig.data.pose_position != 'POSE':
                raise ValueError('Reusable animation requires rigs in pose evaluation mode')
            data = rig.animation_data
            if rig.constraints or any(b.constraints for b in rig.pose.bones) or (data and (data.drivers or data.nla_tracks)):
                raise ValueError('Bake constraints, drivers and NLA to a standalone Action before reuse')
            if rig.data.animation_data:
                raise ValueError('Animated armature data is not supported for Action reuse')
        if any(abs(source.matrix_world[i][j] - Matrix.Identity(4)[i][j]) > 1e-5 for i in range(4) for j in range(4)):
            raise ValueError('Apply source armature object transforms before Action reuse')
        if source.animation_data.action_blend_type != 'REPLACE' or source.animation_data.action_influence != 1:
            raise ValueError('Reusable source Action must use REPLACE with full influence')
        allowed_paths = set()
        for bone in arm.data.bones:
            other = source.data.bones[bone.name]
            parent = lambda b: b.parent.name if b.parent else None
            if parent(bone) != parent(other) or any(abs(bone.matrix_local[i][j] - other.matrix_local[i][j]) > 1e-5 for i in range(4) for j in range(4)) or abs(bone.length - other.length) > 1e-5:
                raise ValueError('Reusable animation rest skeleton mismatch: ' + bone.name)
            for setting in ('inherit_scale', 'use_inherit_rotation', 'use_local_location', 'use_relative_parent'):
                if getattr(bone, setting) != getattr(other, setting):
                    raise ValueError('Reusable animation bone settings mismatch: ' + bone.name)
            pose, original = arm.pose.bones[bone.name], source.pose.bones[bone.name]
            pose.rotation_mode = original.rotation_mode
            for prop in ('location', 'scale', 'rotation_euler', 'rotation_quaternion', 'rotation_axis_angle'):
                setattr(pose, prop, getattr(original, prop).copy() if hasattr(getattr(original, prop), 'copy') else tuple(getattr(original, prop)))
                allowed_paths.add(original.path_from_id() + '.' + prop)
        slot = getattr(source.animation_data, 'action_slot', None)
        if getattr(action, 'is_action_layered', False):
            if slot is None:
                raise ValueError('Reusable Action needs an active slot')
            curves = [curve for layer in action.layers for strip in layer.strips if strip.type == 'KEYFRAME' for bag in [strip.channelbag(slot)] if bag for curve in bag.fcurves]
        else:
            curves = list(action.fcurves)
        if not curves or any(curve.data_path not in allowed_paths for curve in curves):
            raise ValueError('Reusable Action must contain only bone transform channels; bake object/custom-property motion first')
        arm.animation_data_create()
        arm.animation_data.action = action
        if slot is not None:
            arm.animation_data.action_slot = slot
        arm.animation_data.action_blend_type = 'REPLACE'
        arm.animation_data.action_influence = 1
        animation_reuse = {'armature': library['armature'], 'action': action.name, 'bones': len(arm.data.bones), 'compatibility': 'identical-rest-skeleton'}
        # Keep only the reused Action, never export the library's source object.
        bpy.data.objects.remove(source, do_unlink=True)
        scene.frame_set(scene.frame_current)
    # Blender X,Y,Z -> Roblox X,Z,-Y. Pose transforms are relative to rest,
    # conjugated into the same basis; no Euler-angle approximations.
    basis = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    basis_inverse = basis.inverted()
    rest_inverses = {
        bone.name: (bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local).inverted()
        for bone in arm.data.bones
    }
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
            posed = pose.parent.matrix.inverted() @ pose.matrix if pose.parent else pose.matrix
            delta = basis @ (rest_inverses[bone.name] @ posed) @ basis_inverse
            rot = delta.to_3x3()
            gram = rot.transposed() @ rot
            if abs(rot.determinant() - 1) > 1e-4 or any(abs(gram[i][j] - (1 if i == j else 0)) > 1e-4 for i in range(3) for j in range(3)):
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
scene.render.use_persistent_data = job.get('persistentData', True)
if job.get('renderThreads') is not None:
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = job['renderThreads']
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
(output / 'report.json').write_text(json.dumps({'ok': True, 'blender': bpy.app.version_string, 'reviewProfile': job.get('reviewProfile', 'full'), 'renderSamples': scene.cycles.samples, 'persistentData': scene.render.use_persistent_data, 'renderThreads': scene.render.threads if scene.render.threads_mode == 'FIXED' else None, 'timings': timings, 'meshes': stats, 'bounds': [list(lo), list(hi)], 'animationFrames': len(frames) if job.get('animation') else 0, 'animationReuse': animation_reuse}, indent=2), encoding='utf-8')
