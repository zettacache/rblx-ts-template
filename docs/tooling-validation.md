# Tooling validation

Verified locally on Windows with Node 24.22.1 and Blender 5.2.3 LTS. This records the port's acceptance scope, not a promise of future hardware timings or a production-art approval.

## Offline checks

- All 125 extracted/new pipeline tests pass with workspace-local temporary directories. Coverage includes bounded Blender batches, cache invalidation/copy independence, malformed geometry/animations, input encodings, upload ambiguity/idempotency, ownership, controller crashes, device/input restoration and source-transfer corruption.
- Initializer and cleanup protection tests pass. The initializer sets both Rojo and the Studio CLI place restriction. Clean refuses unresolved or unreadable recovery evidence.
- Eight project-scoped agent definitions were parsed with Python's TOML parser bundled with Blender. The roles were installed as configuration; they were not launched during extraction.
- All relative CLI module dependencies resolve locally. No npm dependencies were added for the extracted tools.

The Windows sandbox rejected atomic replacement in its redirected system temporary directory. Workspace-owned test scratch fixed that restriction. A subsequent transient file-lock failure exposed a reliability gap: atomic file replacement now retries only EPERM/EACCES/EBUSY a bounded number of times without deleting the current destination. Exhaustion still fails closed. Cloud/Studio mutations are never retried by this helper.

## Real Blender fixture

The neutral companion fixture produced editable `.blend`, FBX, GLB, three static renders, four motion renders and a 33-sample animation. Its preview front render was visually inspected. Full and preview animation JSON have the same SHA-256:

```text
e7dff8c49ae882070933b1d0de2ff80c3d5ed56c896799ddb248d28aec233953
```

Representative single local runs:

| Mode                                     | Wall time |
| ---------------------------------------- | --------- |
| Full, 384 px / 24 samples                | 23.86 s   |
| Preview, 256 px / 8 samples              | 8.31 s    |
| Preview cache reuse through batch runner | 0.53 s    |

The batch runner shares the executable probe/hash, preserves per-job verification and copies cached artifacts into fresh directories. Mock tests additionally verify concurrency bounds and ordered reports. The local example batch has one job; multi-job throughput depends on hardware and recipe workload. Timing varies with startup and machine load.

Raw local evidence lives under ignored `build/`: Blender manifests/logs, `blender-full.json`, `blender-preview-final.json`, `blender-batch-final.json`, and `tooling-final.txt`. These contain local paths and disposable outputs and are not shipped in Git.

## Native/cloud boundaries

The new direct CLI inventory attempt could not reach Studio from the sandbox. Its protocol, ownership, recovery and upload paths were verified with injected mocks; no live native write, native animation export or cloud upload was performed during extraction. The base template's separate Studio handshake smoke test passed during initial template setup and does not establish acceptance of these newly ported authoring tools.

Whole-place capture/import and game-specific native acceptance remain outside this extraction. The source Monster RNG repository was only read; no game assets, scripts, project settings, secrets or live coordination records were changed there.
