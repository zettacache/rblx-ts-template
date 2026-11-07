# Focused verification and review tools

These additions adapt Monster RNG's accumulated tooling to this template. Source
hashes before adaptation are in `provenance/monster-rng-additions.json`. They retain
the current Studio guard, configured target, reservation ledger, local unpublished
place verification, recovery and cleanup contracts. Blender, retargeting, runtime
source and `npm run verify` remain authoritative in their existing paths.

## Scoped source identity

A reviewed `studio:turn` plan may declare `sourceFiles`: a nonempty array of exact
repository-relative files. The default remains the existing full source snapshot.
Scopes reject globs, traversal, duplicates, missing files and junction escapes.
They always include `default.project.json`, `test.project.json`, `studio-tools.json`,
`package.json`, `package-lock.json` and `tsconfig.json`.

List every dependency of the check: canonical TS, compiled files where applicable,
fixture/probe code, assets and shared modules. Unlisted files may change without
invalidating that scoped turn. A scope is a dependency declaration, not automatic
dependency discovery or proof of a fresh build. Run `npm run verify` first. Plans
that set `sourceStable: false` cannot declare a file scope.

```json
{
  "operation": "focused-check",
  "command": ["node", "scripts/my-check.cjs"],
  "cleanupProbe": "cleanup.luau",
  "sourceFiles": ["src/shared/my-feature.ts", "scripts/my-check.cjs", "cleanup.luau"]
}
```

The filenames above are placeholders. Supply a reviewed check and a real,
operation-specific cleanup probe before requesting a turn.

## Ready verification batches

`studio:verify-batch` groups one to six already prepared verification plans under
one FIFO admission. It executes them sequentially, records declared evidence and
omitted checks, verifies source/device/fixture state after each success, and stops
on failure without retrying. The time budget is soft: it prevents starting later
steps, never kills a possibly mutating child at a deadline.

```json
{
  "version": 1,
  "operation": "feature-acceptance",
  "maxDurationMs": 300000,
  "inputs": ["shared-fixture.json"],
  "steps": [
    { "name": "input", "plan": "input-turn.json", "evidence": "native-client" },
    { "name": "layout", "plan": "layout-turn.json", "evidence": "native-visual" }
  ]
}
```

Manifest paths resolve relative to the manifest. Plan cleanup paths resolve
relative to each plan. Each command uses an explicit Node `.cjs`/`.js` entrypoint
with argv, no shell; all plans share the same reviewed cleanup-probe contents.
Evidence labels are `offline`, `edit-engine`, `native-client` or `native-visual`;
labels describe the intended check and do not promote a command pass into visual
acceptance. `${OUTPUT}` in step arguments expands to the fresh batch directory.

```sh
npm run studio:verify-batch -- prepare docs/checks/batch.json --out build/batches/review-1
# Optional: add --only input; omitted checks stay explicit in the receipt.
npm run studio:turn -- request build/batches/review-1/turn.json --studio ID --request batch-1 --owner developer --task acceptance
npm run studio:turn -- run build/batches/review-1/turn.json --studio ID --request batch-1 --owner developer --task acceptance
```

Preparation is offline and freezes input hashes. Each run requires a fresh
output directory. Plans with `sourceStable: false` and nested turn/batch commands
are rejected. All selected scoped children produce a union scope for the parent;
one full-source child keeps the parent full-source. Child PIDs are registered in
the original turn before a launch gate permits fixture execution. Unconfirmed
children retain recovery evidence and prevent release while alive.

## Repeatable visual reviews

`studio:visual-review capture` runs named views through the existing owned native
lifecycle and game-scoped input. It records source/reference/image hashes, device,
viewport, camera and lighting. Each view gets a fresh owned test. No game profile,
UI root, saved-data bypass or content policy is built into the tool.

```json
{
  "version": 1,
  "name": "Feature review",
  "sources": ["../../src/client/my-feature.tsx"],
  "references": ["reference.png"],
  "ready": "ready.luau",
  "devices": {
    "desktop": { "id": "default" },
    "portrait": { "id": "EXACT_SUPPORTED_PHONE_PRESET", "orientation": "Portrait" },
    "landscape": { "id": "EXACT_SUPPORTED_PHONE_PRESET", "orientation": "LandscapeLeft" }
  },
  "views": [
    {
      "name": "world",
      "kind": "world",
      "device": "desktop",
      "position": [0, 12, 24],
      "lookAt": [0, 3, 0]
    },
    {
      "name": "menu-phone",
      "kind": "ui",
      "device": "portrait",
      "open": "LocalPlayer.PlayerGui.Feature.Open",
      "close": "LocalPlayer.PlayerGui.Feature.Menu.Close",
      "check": "layout.luau"
    }
  ]
}
```

Replace example paths and discover supported native device IDs before use.
Mobile presets must be explicit; desktop defaults to the native default device.
`ready` and per-view `check` probes run on Client; optional `setupServer` runs
on Server. Probes are trusted project Luau and must return `{passed = true, ...}`
after checking the intended state. Use bounded readiness assertions. Optional
`player` triples reposition the test character; optional `interactions` entries
contain `click` instance paths and `assert` Client probe filenames. Persistent
edits are outside this capture workflow.

Run capture only as the command of a configured matching `studio:turn` plan with
a reviewed cleanup probe. For example its command argv can be:

```json
[
  "node",
  "scripts/studio-visual-review.cjs",
  "capture",
  "docs/checks/views.json",
  "--out",
  "build/visual/before"
]
```

After a separately owned revision/capture, generate the gallery offline:

```sh
npm run studio:visual-review -- compare build/visual/before/report.json build/visual/after/report.json --out build/visual/comparison.html
```

Comparison requires successful captures, matching manifests, view sets,
devices/viewports and unmodified image bytes. Lighting must match unless the
explicit `--lighting-study` option is used. Inspect full images and record visible
improvements and remaining issues. No aesthetic score or automatic visual
acceptance is generated. Emulated views do not establish physical-device input
or target-device performance.

## Offline asset inventory

```sh
npm run verify
npm run audit:assets
# Optional: --place build/game.rbxlx --out build/release-audit/report.json --python python
```

The audit uses Python 3's standard-library XML parser (`python` on Windows,
`python3` elsewhere). No npm dependencies are added. It inventories classes,
asset references, script indicators, explicit physics flags and receipt-backed
triangle estimates. Source inclusion checks conventional native `studio/` scripts
and this template's generated `out/` directory mappings, excluding specs. Package,
binary model and nested project mappings remain inventory-only. A mismatch exits
with code 2; parse or input failures exit with code 1. Reports stay under the
checkout's `build/release-audit/`.

Compiled-source inclusion does not establish compilation freshness. Receipt
permissions are historical; XML cannot prove hosted access, rendered geometry,
runtime populations, memory use or performance. The tool makes no cloud calls.

## Optional owned Rojo serving

`npm run serve:owned` is an advanced, opt-in server command for a configured
matching reservation. It uses pinned executable discovery, a machine-wide port
startup lock and listener generation/checkout/mapping/reservation identity.
The reviewed current checkout remains authoritative; it never silently selects
another Git worktree. Unknown listeners and unresolved previous operations are
refused. Reused listeners have no stop handle; only the original launcher can
stop its child. Device/test turns still require Rojo to be stopped first.

This does not replace `npm run serve` or `npm run dev`. For an owned sync operation,
use a long-running turn command with `sourceStable: false`, stop its child through
the original terminal, then let the turn verify its operation-specific cleanup.
Live listener identity inspection currently uses Windows process metadata;
unsupported platforms fail closed. The portable regression suite injects process
identity and exercises startup/reuse/recovery without starting Rojo or Studio.

## Extraction evidence

Regression coverage includes path/junction rejection, source drift, launch gates,
serial execution, omitted coverage, cleanup failures, partial capture startup,
device restoration, unknown/replaced listeners, receipt geometry integrity and
compiled-source mismatches. `npm run test:tooling` discovers these tests.
Offline injected-transport checks do not prove live Studio transport reliability.
