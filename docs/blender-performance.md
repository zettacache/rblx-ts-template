# Blender performance

The follow-up optimization preserves render resolution/samples, requested views, export formats and animation samples. It changes how work is performed:

- Cycles retains render data across views and animation frames inside the same isolated job. Set `persistentData: false` or `--no-persistent-data` when memory is more important than rerender time.
- Animation sampling precomputes rest/basis inverses and calculates each rotation Gram matrix once. Transform validation remains enabled.
- Fresh runs hash the output inventory once and reuse those descriptors for the promoted artifact subset. Cache hits retain source inventory/hash verification and copy independence; only the rewritten job-file descriptor needs recomputing afterward.
- `--threads auto` lets parallel batches share the host's logical render-thread budget. Explicit job settings or a numeric `--threads` override it. Automatic threading remains the default because fixed limits were not faster on the fixture.
- These execution settings participate in cache identity. Changing them invalidates reuse, and every recipe/worker/library hash and artifact checksum is still verified.

## Local measurements

Three runs per version, alternating order, used the same 256-pixel / 8-sample preview fixture and installed Blender 5.2.3 LTS on Windows. The baseline used the worker frozen from Git before this change; all runs used separate output directories and the same executable identity. No other tests were run concurrently with these measurements.

| Median             | Previous worker | Optimized worker |
| ------------------ | --------------- | ---------------- |
| Seven render views | 3.370 s         | 3.016 s          |
| Worker execution   | 4.245 s         | 3.959 s          |
| Total job          | 8.093 s         | 7.911 s          |

That is approximately 10.5% lower render time and 2.3% lower total time for this small fixture. Startup/export variation affects total time; these results do not establish a universal speedup or predict complex-scene throughput. Bounded parallel threading is intended to avoid oversubscription rather than guarantee faster rendering for every batch.

A two-job check took 11.31 s with 12 threads per renderer and 13.72 s with 6 threads per renderer. Because budgeting was slower on this workload, it ships as an opt-in resource control instead of a changed default. The pipeline retains isolated Blender processes per job.

All six runs retained exactly 33 animation samples, the same animation JSON hash, mesh statistics and bounds. Comparing decoded PNG pixels across all seven views produced 35 matching comparisons with maximum difference zero. PNG file hashes can differ because Blender stores per-run metadata; pixel comparisons distinguish that from a visual change.

A separate full-quality check retained 384-pixel output and 24 samples. The single paired run took **26.67 s before and 18.12 s after**, with render stages of **15.73 s and 10.55 s**. All seven decoded full-quality images also matched exactly, with unchanged animation data, mesh statistics and bounds. This single pair can include startup/cache variation; it supports correctness and a local improvement, not a general throughput claim.

Raw evidence is under ignored `build/blender-optimization/`: `benchmark.json`, `pixel-comparison.json`, `full-comparison.json`, `full-pixel-comparison.json`, `threads.json`, `parallel-comparison.json` and the corresponding job manifests/logs. The single-job 1/4/8-thread sweep did not beat the automatic baseline, so no arbitrary low thread cap was added to the default path. New manifests also separate executable identity, input hashes, cache lookup and artifact verification timings for future profiling.

## Usage

```sh
npm run blender -- run scripts/blender/examples/companion.json --profile preview
npm run blender:batch -- batch.json --jobs 2 --profile preview --reuse
npm run blender:batch -- batch.json --jobs 2 --threads 4 --profile preview
npm run blender:batch -- batch.json --jobs 2 --threads auto --profile preview
npm run blender -- run job.json --no-persistent-data
```

The offline regression suite checks configuration validation, explicit/automatic thread budgets, cache invalidation and accurate copied inventories. Real Blender comparisons cover the worker changes. No Studio or cloud operations are involved.

Validation: formatting, linting and roblox-ts build pass; 128 pipeline tests plus initializer/recovery tests pass.
