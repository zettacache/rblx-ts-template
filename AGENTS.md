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
