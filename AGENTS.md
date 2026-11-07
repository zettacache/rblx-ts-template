# Working in this template

Read README.md and docs/architecture.md before changing runtime structure.
Read docs/tooling.md for asset/Studio commands and docs/team.md for optional specialist roles.

- Runtime source is TypeScript in src. Never edit generated out, include, build, or flamework.build.
- Use the pinned Node/npm versions and tools in rokit.toml. Preserve package-lock.json.
- Jecs owns authoritative simulation state. Declare system order in src/server/main.server.ts.
- Keep systems non-yielding. Queue validated network commands for the simulation step.
- Flamework networking contracts live in src/shared/networking.ts. Keep server/client endpoint configuration in their respective directories and retain incoming guards.
- Validate ownership, protocol versions, numeric bounds, cooldowns, and request rates as applicable. Type guards only validate payload shape.
- Keep modules used by offline tests independent of Roblox services and networking initialization.
- Tests use *.spec.ts modules, returning a TestEZ suite function. The production Rojo project excludes specs and TestEZ implementation files.
- Disconnect connections and delete owned entities on removal/shutdown.
- For runtime changes run npm run check, npm test, and npm run build:place. For tooling changes also run npm run test:tooling.
- npm run test:studio opens a dedicated test place; press Play and require [Smoke] PASS. Lune tests do not prove live networking or engine behavior.
- CI runs checks on Windows and Linux. Keep scripts portable; use Node filesystem APIs with fixed, workspace-contained cleanup targets.
- Do not publish places, create cloud resources, change external Studio places, or push commits unless requested.
- Never inherit Monster RNG's place/creator IDs, permissions, active turns, receipts, or gameplay policies. studio-tools.json is unconfigured by default.
- Live Studio commands must use the configured target and matching studio:turn reservation. Stop Rojo before authoring; never adopt another owner's test or blindly retry an ambiguous mutation.
- Keep editable asset sources durable. Do not erase unresolved receipts/journals to bypass a refused clean command.

## Presentation quality

- Before player-facing UI, modeling, animation, VFX or SFX work, read `docs/art-direction/README.md`. Use `docs/art-direction/feature-brief.md` to record the chosen direction and acceptance evidence beside the feature sources.
- Establish a coherent project identity from references; use `docs/ui/style-lab/` as a worked example, not a mandatory genre or finished native component library. Preserve shared shape, palette, material, typography and timing decisions across disciplines.
- Review combined feedback, readability, touch/controller states, reduced motion, muted audio, repeated effects and target-device performance. Keep editable sources durable; distinguish HTML concepts, offline builds and actual Studio visual/audio evidence. Do not claim polish from compilation alone.

## Commits and chat completion

- Auto-commit completed, verified work in this project without asking for commit confirmation, unless the user requests otherwise. Commit at coherent completion points; run the checks appropriate to the change first.
- Use short, imperative commit subjects, preferably 50 characters or fewer (for example, `Add rig retargeting`). Include a body only when it explains a material decision.
- Stage only owned changes. Inspect the staged diff and preserve other chats' edits and staged work; coordinate shared files and Git operations. Read-only review tasks report findings without creating commits. If checks, ownership or Git access block a commit, report the blocker instead of claiming completion.
- Honor existing push instructions; auto-commit alone does not authorize a new remote push, force-push, history rewrite or publication.
- Before finishing a chat, update its coordination handoff with the outcome, verification, commit/push status and remaining work. When its requested work, required checks, owned commits and any authorized push are complete, and it has no unresolved blocker, pending approval or running task, end the final response with `Ready to archive.` Other chats' independent work need not be complete.
- If this chat still has required work, say what remains instead of declaring archive readiness. Announcing readiness does not archive the chat; archive it only when the user requests that action.
