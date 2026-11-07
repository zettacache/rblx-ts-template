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

A job declares a script and/or `.blend`, export formats, views, size and optional animation. Paths resolve relative to the job JSON. A batch declares `version: 1` and a `jobs` array of paths relative to the batch file. Jobs run in separate background Blender processes; the default one worker avoids oversubscribing CPU render threads. `--jobs 2` through `4` is available when measured resource limits permit it. Every job is preflighted before any starts. A batch reports every success/failure in input order and exits nonzero on failure. It probes/hashes the Blender executable once for the batch.

- Full review uses the requested resolution and 24 CPU Cycles samples; preview caps size at 256 pixels and uses 8 samples. Geometry, requested formats/views, and animation samples are preserved.
- Each job freezes its recipe, input blend and worker into a fresh UUID output directory under `build/blender`. Outputs include editable `scene.blend`, FBX/GLB, PNG views, optional sampled animation JSON, log, report and SHA-256 manifest.
- `--reuse` is an explicit assertion that the recipe is deterministic. Declare all external input files in `dependencies`. Keys include normalized job settings, input/dependency hashes, Blender path/version/binary hash, worker, runner, cache, animation validator and text-reader hashes.
- Reuse verifies the complete cached inventory and copies files into a new directory. No hard links or mutation of the cached source. Missing, corrupt or incomplete outputs rebuild; failed jobs never publish a reusable success.
- Pack images into input blends and make linked libraries local. Preserve pivots, scale and export names. Preview renders are iteration evidence; inspect full views and native Studio results for final acceptance.
- Promote chosen editable sources, recipes, exports and nonsecret receipts to a durable `assets/` folder. `build` is disposable. Asset IDs alone are not backups.

The neutral two-bone fixture verifies export and sampling. It is a pipeline test, not production game art. See `docs/tooling-validation.md` for measured local timings.

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
