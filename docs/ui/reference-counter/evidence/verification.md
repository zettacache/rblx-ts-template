# Native reference-counter acceptance

Reviewed on 2026-11-07 in an owned unpublished local smoke place. Selected captures are native Studio images, not HTML renders. The card was moved from bottom to top after the first portrait review showed overlap with movement controls. StarterGui now uses sensor orientation so portrait is actually supported.

| Capture       | Observed viewport | Result                                                      |
| ------------- | ----------------- | ----------------------------------------------------------- |
| desktop.jpg   | 645 × 445         | Readable; native click, client/server count 2               |
| portrait.jpg  | 413 × 735         | Portrait assertion passed; card clear of movement controls  |
| landscape.jpg | 735 × 413         | Landscape assertion passed; card clear of movement controls |

The device simulator used its discovered iPhone 6 Plus preset. Native calibrated mouse input activated Add one exactly once; this establishes simulated mobile layout and button behavior, not physical-device touch acceptance. Both mobile runs checked readiness, invalid/duplicate requests, initial state, native activation and matching authoritative count, then stopped their owned sessions and restored desktop simulation.

Final complete command: `npm run verify -- --studio <owned-smoke-id>`. It passed doctor, format/lint/compiler checks, 8 Node tooling tests, 133 pipeline regressions, 12 compiled Luau tests (including the existing loader tests), production/smoke builds and native acceptance. Exact owned staged runtime independently passed the offline command with 10 Luau tests; the extra 2 loader tests belong to preserved concurrent work.

Scratch evidence in the implementation checkout: `build/verification/3b4f1ba4-b746-484e-b20c-b34d9843483e/report.json`, `build/studio-smoke/333a4bbc-73c8-4992-86bb-badaecf8ae2a/report.json`, `build/mobile-smoke/report.json` and released mobile turn `build/turns/895eeefc-3cd8-479c-b52b-11d3729028b1.json`. The native source fingerprint was `557ef3025179f85b9f573842ba973c3bd0554debd67eb652f8bb4f107b3fca69` with temporary local target configuration 0; the template target was restored to null after cleanup. No external place, asset upload or publication was used.

HTML preview was unavailable: localhost browser requests timed out, and file navigation was blocked by browser policy. The editable prototype and states remain available, but matched HTML/native visual comparison is unverified. Pending/retry/capped native screenshots, physical devices and multiplayer are outside this acceptance.
