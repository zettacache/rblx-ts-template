# Asset and Studio tooling

These commands are generalized from Monster RNG. Source-byte provenance is recorded in `docs/provenance/monster-rng-tooling.json`. Only reusable tooling and neutral test fixtures were extracted. Game scripts, content/assets, production IDs, authorizations, secrets, live receipts and historical handoffs are not part of the template.

## Blender

Install Blender separately; use `BLENDER_EXE` for a specific executable, otherwise the runner discovers an installed Windows version or `blender` on PATH. The worker uses Blender's own Python and needs no system Python or pip packages. Recipes are trusted executable Python, not sandboxed data.

```sh
npm run blender:doctor
npm run blender -- run scripts/blender/examples/companion.json --profile preview
npm run blender -- run scripts/blender/examples/companion.json --profile full
npm run blender:batch -- scripts/blender/examples/batch.json --profile preview --reuse --jobs 1
```

A job declares a script and/or `.blend`, export formats, views, size and optional animation. Paths resolve relative to the job JSON. A batch declares `version: 1` and a `jobs` array of paths relative to the batch file. Jobs run in separate background Blender processes with automatic render threading by default. With `--threads auto`, unspecified render threads are divided across the workers using the available logical CPU count. A job `renderThreads` overrides that automatic budget; a numeric CLI `--threads 1..256` overrides both. The budget controls render threads, not an operating-system CPU quota, and can be slower for some workloads. Every job is preflighted before any starts. A batch reports every success/failure in input order and exits nonzero on failure. It probes/hashes the Blender executable once for the batch.

- Full review uses the requested resolution and 24 CPU Cycles samples; preview caps size at 256 pixels and uses 8 samples. Geometry, requested formats/views, and animation samples are preserved.
- Cycles persistent render data is enabled within each job to reuse scene data across views and motion frames. It uses more memory until that isolated Blender process exits. Use job `persistentData: false` or CLI `--no-persistent-data` to disable it. See [Blender's performance documentation](https://docs.blender.org/manual/en/latest/render/cycles/render_settings/performance.html).
- Manifests separate executable identity, input hashing, cache lookup, Blender process, and verification timings. Worker reports separate scene build, export, static renders and motion renders. Cache-hit timings describe the copy/verification work; original build timings are retained separately.
- Each job freezes its recipe, input blend and worker into a fresh UUID output directory under `build/blender`. Outputs include editable `scene.blend`, FBX/GLB, PNG views, optional sampled animation JSON, log, report and SHA-256 manifest.
- `--reuse` is an explicit assertion that the recipe is deterministic. Declare all external input files in `dependencies`. Keys include normalized job settings, input/dependency hashes, Blender path/version/binary hash, worker, runner, cache, animation validator and text-reader hashes.
- Reuse verifies the complete cached inventory and copies files into a new directory. No hard links or mutation of the cached source. Missing, corrupt or incomplete outputs rebuild; failed jobs never publish a reusable success.
- Pack images into input blends and make linked libraries local. Preserve pivots, scale and export names. Preview renders are iteration evidence; inspect full views and native Studio results for final acceptance.
- Promote chosen editable sources, recipes, exports and nonsecret receipts to a durable `assets/` folder. `build` is disposable. Asset IDs alone are not backups.

The neutral two-bone fixture verifies export and sampling. It is a pipeline test, not production game art. See `docs/tooling-validation.md` for extraction checks and [Blender performance measurements](blender-performance.md) for the subsequent optimization comparison.

### Reusable rig animations

Keep one canonical skeleton per rig family and author idle/walk/attack clips once as Blender Actions. Mesh shapes, materials and weights can vary around that skeleton. Save each clip with its source rig's Action and slot active in a durable, local `.blend` library. Existing exported `scene.blend` files can serve as libraries after promotion out of `build`. Blender's [Action and slot model](https://docs.blender.org/api/5.2/bpy.types.AnimData.html) lets the worker apply the same transform channels to another armature.

Add this to a target job's existing `animation` settings (keep its target armature, rootPart, frame range, fps and scale):

```json
{
  "library": {
    "blend": "../../assets/animations/shared-idle.blend",
    "armature": "CanonicalRig"
  }
}
```

Paths are relative to the job JSON. The source rig's active Action and slot replace the target's active Action. The worker preserves source rotation modes and unkeyed bone transform values. The resulting editable scene embeds the Action; FBX/GLB, sampled Roblox clip JSON and four motion review frames use it. The report records which Action was reused. The library bytes are automatically hashed and frozen as `animation-library.blend`; changing them invalidates `--reuse`, and cache hits relocate their paths into the fresh output directory.

Direct reuse requires identical bone names, parents, rest matrices, lengths and inheritance settings, with applied object transforms and pose evaluation enabled. Target object names and mesh appearance may differ. Bake constraints, drivers and NLA into a standalone bone-transform Action first; the worker rejects those dependencies and object/custom-property animation. For changed proportions, use the explicit retargeting mode below. This does not automatically transfer Roblox asset permissions or publish animations.

`scripts/blender/examples/companion-variant.py` demonstrates changing a mesh while consuming a shared clip. Run `npm run test:blender` for an optional real Blender integration check: it builds the canonical fixture, applies its Action to a mesh variant with a different armature name/rotation mode, compares all 33 sampled frames, checks cache reuse, and rejects incompatible rest skeletons, bone names and constraints. This passed locally with Blender 5.2.3 LTS. It writes disposable evidence under `build/blender-reuse`; ordinary tooling tests do not require Blender.

### Retargeting different proportions

Add `retarget` beside `library` inside the target job's `animation` settings:

```json
{
  "library": { "blend": "../../assets/animations/shared-idle.blend", "armature": "CanonicalRig" },
  "retarget": {
    "boneMap": { "Root": "Root", "Torso": "Body" },
    "translation": "bone-length"
  }
}
```

`boneMap` maps **target names to source names**. It must cover every bone on both rigs once and preserve their parent hierarchy. Bone lengths, rest offsets, rolls and names can differ. Extra twist/helper bones, different chain topology, and automatic anatomical matching are not supported; prepare a corresponding export skeleton first. Omitting `retarget` keeps strict direct reuse.

The worker samples the source at every integer frame in the job range, measures parent-relative motion against its rest skeleton, converts motion axes into the target bone's rest basis, then applies that motion to the target rest skeleton. Rest proportions remain unchanged. `translation: "bone-length"` (default) multiplies each bone's animated translation by that target/source bone length ratio; `"none"` preserves translation distances while still converting axes. This includes the root bone: its length ratio is a mechanical scaling choice, not an automatic leg-length/stride estimate. Both rigs must use the same applied coordinate system and units; `studsPerUnit` converts the final output to Roblox units.

The result is a new, editable quaternion Action baked at the configured fps, with linear keys between sampled frames. The worker uses Blender's [local/pose matrix conversion](https://docs.blender.org/api/5.2/bpy.types.Bone.html#bpy.types.Bone.convert_local_to_pose) for target inheritance settings and reads back every baked bone matrix before export. Nonrigid scale/shear, incomplete maps, changed hierarchy, and unrepresentable results fail. The existing standalone Action restrictions apply. Reports include the map, translation ratios, baked frame count and maximum matrix error; all settings participate in cache identity.

Retargeting transfers motion; it does **not** solve foot planting, hand contacts, ground collision or IK. Review the four motion images and final animation in Studio for sliding, intersections and contact changes. Keep the canonical source and the retarget job so corrected variants can be regenerated rather than editing the only copy of a clip.

`npm run test:blender` also exercises renamed bones with 2x/3x bone lengths, changed roll, animated translation and parent rotation; it checks every exported frame for both translation modes, cache reuse, incomplete maps and wrong parent mapping. Evidence is written under `build/blender-reuse`.

## Studio configuration and inspection

`studio-tools.json` starts with `expectedPlaceId: null`. Set it through the initializer:

```sh
npm run init:project -- my-game --place-id 123456789
npm run studio -- studios
npm run studio:doctor
npm run studio -- tree Workspace --depth 2 --limit 50
npm run studio -- inspect Workspace.Baseplate
npm run studio -- logs
```

Studio must be open with MCP enabled in Assistant settings. The CLI discovers the installed official `StudioMCP.exe` and reuses its authentication without reading/copying credential files. Set `ROBLOX_STUDIO_MCP_EXE` when discovery is unavailable, including other platforms. Binaries are not bundled in the template.

No configured target is selected automatically. Inventory commands work without a place. An explicit `--studio ID` permits deliberate read-only inspection; IDs are ephemeral and must be rediscovered. An authoring/test turn also verifies the configured place and owns the exact Studio instance. Never point the template at a different project merely because it is open.

`studio:sources` exports up to 16 complete editor/stored sources in bounded checksum-verified chunks. It saves raw UTF-8 scripts and a manifest and reports partial/changed sources as failures. Its Luau body is read-only, but the generic bridge execution call still requires a turn; this avoids exempting arbitrary Luau from the guard. Source export is not a model/terrain backup.

## Owned Studio turns

Stop `npm run dev`/Rojo before live authoring or tests. Use an operation plan with a command argv array and an inspected, operation-specific cleanup probe. The cleanup probe must verify that temporary fixtures are gone and return a `robloxStudio: 1`, `ok: true`, `clean: true` envelope. Do not use an unconditional clean assertion for work that creates fixtures.

```json
{
  "operation": "inspect",
  "command": ["node", "scripts/studio.cjs", "status"],
  "cleanupProbe": "cleanup.luau"
}
```

```sh
npm run studio:turn -- request plan.json --studio STUDIO_ID --request inspection-1 --owner developer --task inspection
npm run studio:turn -- run plan.json --studio STUDIO_ID --request inspection-1 --owner developer --task inspection
```

The FIFO coordinator binds project, checkout, Studio, owner/task and token. It snapshots source, registers nested operations, records only tool/context timings, verifies Edit mode/device restoration/fixture cleanup and stops only marker-verified owned tests. Expiry/dead processes never transfer ownership. Ambiguous failures retain journals and require inspection/recovery using the original plan/record. Do not blindly repeat mutations. Tokens and operation journals live in ignored local state; never copy them between projects or commit them.

The machine ledger is under `RobloxStudioTools/coordination`; it coordinates adopters of this template, not arbitrary external editors or Monster RNG's legacy ledger. Direct MCP/manual actors must respect the same human ownership convention.

## Authoring and asset commands

| Command                                                                     | Scope                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `studio:author -- preview plan.json`                                        | Offline validation                                              |
| `studio:author -- inspect plan.json --out build/authoring/review.json`      | Freeze exact before-state under a turn                          |
| `studio:author -- apply review.json`                                        | Apply reviewed edits with recovery journal and readback         |
| `studio:animation -- validate clip.json`                                    | Offline hierarchy, time, transform and marker checks            |
| `studio:animation -- export clip.json --out build/clip.rbxm`                | Native engine serialization/readback under a turn               |
| `studio:animation -- preview clip.json --rig Exact.Rig.Path`                | Numerical Animator samples on a temporary rig clone             |
| `studio:mesh -- prepare triangles.json --out build/centered.json --center`  | Offline centering with explicit origin metadata                 |
| `studio:mesh -- upload triangles.json --receipt assets/receipts/mesh.json`  | Explicit native signed-in mesh upload under a turn              |
| `studio:assets -- prepare upload.json`                                      | Offline frozen Open Cloud upload review                         |
| `studio:assets -- upload review.json --receipt assets/receipts/upload.json` | Explicit cloud creation using an environment API key            |
| `studio:assets -- poll receipt.json`                                        | Resume the recorded operation without another creation POST     |
| `studio:scenario -- scenario.json --out build/playtests/report.json`        | Owned native input, assertions, captures and device restoration |

Use each command's `--help` for exact options. Upload commands are capabilities, not standing authorization to create cloud assets. Require the current task to call for the upload and verify the intended creator/access. Open Cloud reads `ROBLOX_OPEN_CLOUD_API_KEY` only from the environment; never put keys, cookies or Studio tokens in files. Native uploads preserve per-face color on static triangle geometry; they do not upload skinned/textured rigs. Animation previews verify transforms, not visual gameplay quality. Unknown creation outcomes are never automatically retried.

Persistent native edits must be saved/exported and integrated into project-owned Rojo mappings before claiming durability. The Monster RNG whole-place capture/import path was intentionally excluded: it depends on that game's native `studio/` tree, baseline place and mapping-generation rules and would overwrite this template's Flamework/test mappings. This starter does not promise a generic whole-place round trip. Keep generated TS sources authoritative in `src`.

`clean` refuses unresolved Studio/upload evidence and applied authoring journals. Recover or archive them to durable storage first. No `--force` bypass is supplied. `npm run test:pipelines` runs the injected-transport regression suite with workspace-local temporary files; it does not connect to Studio, upload, or prove live transport reliability.
