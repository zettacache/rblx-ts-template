# Initialize roblox-ts: Blender rig retargeting

Owner: 01a1b64e-ab7a-7a82-bb3d-fbbb4df0c166
Updated: 2026-11-07, America/New_York
Status: complete (implementation and verification)
Checkout: C:\Users\Justin\Documents\mini-clans; master, base ad3fb1b

## Scope and ownership

Own scripts/blender.cjs, scripts/blender/worker.py, scripts/blender/examples/companion-motion.py and companion-retarget.py, scripts/test-blender-reuse.mjs, scripts/test-asset-pipelines.cjs, docs/tooling.md and this handoff. User requested proportional rig retargeting and earlier authorized pushing template changes to origin/master. Preserve peer UI/loading and communication work; no changes to their files or dependencies.

## Decisions and verification

Explicit complete target-to-source bone map with matching parent topology. Bake rest-relative rotations/translations into a target Action, compensate rest axes/roll, retain target proportions, support bone-length-scaled or unscaled translation. Read back every frame. No contact/IK correction or chain-topology inference. Strict direct Action reuse remains the default.

Verified owned changes against base ad3fb1b with `npm run check` (format, lint, compilation), `npm run test:tooling` (130 pipeline tests plus two initializer/recovery tests), and `npm run test:blender` (Blender 5.2.3 LTS). Every one of 33 frames matched expected rest-axis conversion and translation for both scaling modes on renamed bones with 2x/3x lengths and changed roll. Cache reuse and metadata inventory passed. Incomplete maps, hierarchy changes and strict-reuse mismatches failed as expected. The report separates actual bone length ratios from applied translation scales.

Final real Blender evidence: ignored `build/blender-reuse/e171368e-b15c-4e8e-b83d-f8789ad601da/`, including editable scenes, clips, model exports, renders, logs and readback reports. No Studio or cloud writes. No remaining implementation work; only owned files are included in the retargeting commit.

## Peers and communication

Discovered chats by exact checkout: Enable agent and chat communication (01a1b6d7-72d3-70f0-8fd9-2fdf3c297f1f) owns AGENTS.md and docs/team.md guidance; Add default loading screen handler (01a1b6d2-647a-7852-9eb9-408f62b1ab46) owns UI/loading changes. Read the communication handoff and preserve concurrent changes. No overlapping edits or dependency on peer work; no acknowledgment or implementation request dispatched.
