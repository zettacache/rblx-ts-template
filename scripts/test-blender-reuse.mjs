// Explicit integration check: requires Blender, never contacts Studio/cloud.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import blender from "./blender.cjs";
import cache from "./blender-cache.cjs";
import { root } from "./lib.mjs";

const scratch = path.join(root, "build", "blender-reuse", randomUUID());
fs.mkdirSync(scratch, { recursive: true });
const write = (name, doc) => {
	const file = path.join(scratch, name);
	fs.writeFileSync(file, JSON.stringify(doc, null, 2));
	return file;
};
const example = path.join(root, "scripts", "blender", "examples");
const job = JSON.parse(fs.readFileSync(path.join(example, "companion.json")));
job.script = path.join(example, "companion-motion.py");
job.dependencies = [path.join(example, "companion.py")];
job.size = 128;
job.views = ["iso"];
const runtime = { executable: blender.discover(), root: path.join(scratch, "outputs") };
const identity = blender.executableIdentity(runtime.executable);
runtime.executableIdentity = () => identity;
runtime.launch = async (executable, args, log) => {
	try {
		await blender.launch(executable, args, log);
	} catch (error) {
		throw new Error(`${error.message}\n${fs.readFileSync(log, "utf8")}`, { cause: error });
	}
};
const original = await blender.run(write("original.json", job), { profile: "preview" }, runtime);
const variantJob = {
	...job,
	name: "ReusableVariant",
	blend: path.join(original.output, "scene.blend"),
	script: path.join(example, "companion-variant.py"),
	animation: {
		...job.animation,
		armature: "VariantRig",
		library: { blend: path.join(original.output, "scene.blend"), armature: "CompanionRig" },
	},
};
const variantFile = write("variant.json", variantJob);
const variant = await blender.run(variantFile, { profile: "preview", reuse: true }, runtime);
const clip = (result) => JSON.parse(fs.readFileSync(path.join(result.output, "animation.json")));
assert.deepEqual(clip(variant).keyframes, clip(original).keyframes);
assert.deepEqual(clip(variant).channels, clip(original).channels);
assert.equal(variant.report.animationReuse.compatibility, "identical-rest-skeleton");
assert.notDeepEqual(variant.report.bounds, original.report.bounds);
const reused = await blender.run(variantFile, { profile: "preview", reuse: true }, runtime);
assert.equal(reused.cache.reused, true);
assert.deepEqual(reused.cache.artifacts, cache.inventory(reused.output));
assert.equal(
	JSON.parse(fs.readFileSync(path.join(reused.output, "job.json"))).animation.library.blend,
	path.join(reused.output, "animation-library.blend"),
);
const multiply = (a, b) =>
	a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const transpose = (a) => a[0].map((_, i) => a.map((row) => row[i]));
const coordinateBasis = [
	[1, 0, 0],
	[0, 0, 1],
	[0, -1, 0],
];
const retargetJob = {
	...variantJob,
	script: path.join(example, "companion-retarget.py"),
	animation: {
		...variantJob.animation,
		retarget: { boneMap: { Root: "Root", Torso: "Body" }, translation: "bone-length" },
	},
};
for (const translation of ["bone-length", "none"]) {
	const retargetFile = write(`retarget-${translation}.json`, {
		...retargetJob,
		animation: { ...retargetJob.animation, retarget: { ...retargetJob.animation.retarget, translation } },
	});
	const result = await blender.run(retargetFile, { profile: "preview", reuse: true }, runtime);
	const retargeted = clip(result);
	const rest = JSON.parse(fs.readFileSync(path.join(result.output, "retarget-rest.json")));
	for (let frame = 0; frame < retargeted.keyframes.length; frame++) {
		for (const [target, source] of Object.entries(retargetJob.animation.retarget.boneMap)) {
			const axes = multiply(
				multiply(coordinateBasis, multiply(transpose(rest.target[target]), rest.source[source])),
				transpose(coordinateBasis),
			);
			const originalPose = clip(original).keyframes[frame].poses[source];
			const sourceRotation = [originalPose.slice(3, 6), originalPose.slice(6, 9), originalPose.slice(9, 12)];
			const rotation = multiply(multiply(axes, sourceRotation), transpose(axes)).flat();
			const ratio = translation === "none" ? 1 : target === "Root" ? 2 : 3;
			const offset = multiply(
				axes,
				originalPose.slice(0, 3).map((value) => [value * ratio]),
			).flat();
			const expected = [...offset, ...rotation];
			retargeted.keyframes[frame].poses[target].forEach((value, i) =>
				assert.ok(
					Math.abs(value - expected[i]) < 0.00003,
					`${translation} frame ${frame} bone ${target} component ${i}: ${value} != ${expected[i]}`,
				),
			);
		}
	}
	assert.equal(result.report.animationReuse.compatibility, "retargeted");
	assert.deepEqual(result.report.animationReuse.retarget.lengthRatios, { Root: 2, Torso: 3 });
	assert.deepEqual(
		result.report.animationReuse.retarget.translationScales,
		translation === "none" ? { Root: 1, Torso: 1 } : { Root: 2, Torso: 3 },
	);
	assert.ok(result.report.animationReuse.retarget.maxMatrixError < 0.0001);
	const hit = await blender.run(retargetFile, { profile: "preview", reuse: true }, runtime);
	assert.equal(hit.cache.reused, true);
	assert.deepEqual(hit.cache.artifacts, cache.inventory(hit.output));
}
await assert.rejects(
	blender.run(
		write("unmapped-proportions.json", { ...retargetJob, animation: variantJob.animation }),
		{ profile: "preview" },
		runtime,
	),
	/identical bone names/,
);
for (const [boneMap, diagnostic] of [
	[{ Root: "Root" }, /cover every/],
	[{ Root: "Body", Torso: "Root" }, /preserve parent hierarchy/],
]) {
	await assert.rejects(
		blender.run(
			write("invalid-map.json", {
				...retargetJob,
				animation: { ...retargetJob.animation, retarget: { boneMap } },
			}),
			{ profile: "preview" },
			runtime,
		),
		diagnostic,
	);
}
const mismatchScript = path.join(scratch, "mismatch.py");
fs.writeFileSync(
	mismatchScript,
	`import bpy
arm = bpy.data.objects['CompanionRig']
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
arm.data.edit_bones['Body'].tail.z += 0.2
bpy.ops.object.mode_set(mode='OBJECT')
`,
);
const mismatch = {
	...variantJob,
	script: mismatchScript,
	animation: { ...variantJob.animation, armature: "CompanionRig" },
};
await assert.rejects(
	blender.run(write("mismatch.json", mismatch), { profile: "preview" }, runtime),
	/rest skeleton mismatch/,
);
for (const [name, body, diagnostic] of [
	["bone-name", "arm.data.bones['Body'].name = 'Different'", /identical bone names/],
	["constraint", "arm.pose.bones['Body'].constraints.new('COPY_ROTATION')", /Bake constraints/],
]) {
	const script = path.join(scratch, name + ".py");
	fs.writeFileSync(script, "import bpy\narm = bpy.data.objects['CompanionRig']\n" + body + "\n");
	await assert.rejects(
		blender.run(write(name + ".json", { ...mismatch, script }), { profile: "preview" }, runtime),
		diagnostic,
	);
}
console.log(
	JSON.stringify(
		{ ok: true, scratch, frames: clip(variant).keyframes.length, reused: reused.cache.reused },
		null,
		2,
	),
);
