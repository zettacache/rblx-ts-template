# Initialize roblox-ts: template workflow and rig tooling

Owner: 01a1b64e-ab7a-7a82-bb3d-fbbb4df0c166
Updated: 2026-11-07, America/New_York
Status: complete (implementation and verification)
Checkout: C:\Users\Justin\Documents\mini-clans; master, latest tooling commit d8e45f8

## Scope and ownership

Own scripts/blender.cjs, scripts/blender/worker.py, scripts/blender/examples/companion-motion.py and companion-retarget.py, scripts/test-blender-reuse.mjs, scripts/test-asset-pipelines.cjs, docs/tooling.md and this handoff. User requested proportional rig retargeting and earlier authorized pushing template changes to origin/master. Preserve peer UI/loading and communication work; no changes to their files or dependencies.

## Decisions and verification

Explicit complete target-to-source bone map with matching parent topology. Bake rest-relative rotations/translations into a target Action, compensate rest axes/roll, retain target proportions, support bone-length-scaled or unscaled translation. Read back every frame. No contact/IK correction or chain-topology inference. Strict direct Action reuse remains the default.

Verified owned changes against base ad3fb1b with `npm run check` (format, lint, compilation), `npm run test:tooling` (130 pipeline tests plus two initializer/recovery tests), and `npm run test:blender` (Blender 5.2.3 LTS). Every one of 33 frames matched expected rest-axis conversion and translation for both scaling modes on renamed bones with 2x/3x lengths and changed roll. Cache reuse and metadata inventory passed. Incomplete maps, hierarchy changes and strict-reuse mismatches failed as expected. The report separates actual bone length ratios from applied translation scales.

Final real Blender evidence: ignored `build/blender-reuse/e171368e-b15c-4e8e-b83d-f8789ad601da/`, including editable scenes, clips, model exports, renders, logs and readback reports. No Studio or cloud writes. No remaining implementation work; only owned files are included in the retargeting commit.

## Peers and communication

Discovered chats by exact checkout: Enable agent and chat communication (01a1b6d7-72d3-70f0-8fd9-2fdf3c297f1f) owns AGENTS.md and docs/team.md guidance; Add default loading screen handler (01a1b6d2-647a-7852-9eb9-408f62b1ab46) owns UI/loading changes. Read the communication handoff and preserve concurrent changes. No overlapping edits or dependency on peer work; no acknowledgment or implementation request dispatched.

## Auto-commit and archive readiness

The user requested project auto-commit with short messages and an explicit archive-readiness announcement. Added a separate `Commits and chat completion` section to AGENTS.md: commit verified owned work without another confirmation, prefer imperative subjects of at most 50 characters, preserve peer edits and staged work, honor existing push authorization, and finish with `Ready to archive.` only when this chat's required work/checks/commits/push/handoff are complete. No automatic archival or background commit service is installed.

Notified Enable agent and chat communication of the new section and split ownership; native tool returned its thread ID, establishing dispatch. Its communication section and docs/team.md remain untouched. This chat's AGENTS.md commit excludes prior uncommitted communication/UI changes. Workflow-only verification uses focused Prettier and staged diff checks; runtime tests are not applicable. The earlier origin/master push instruction remains active for this change.
