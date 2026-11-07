# Roblox TypeScript Template

A reusable Roblox starter with **roblox-ts, Jecs, and Flamework networking**. Includes formatting, linting, a bounded command queue, ordered simulation systems, Studio profiling, Luau runtime tests, and Windows/Linux CI.

## Requirements

- Node **24.22.1** and npm **11.19.1** (see `.node-version`, `.nvmrc`, and `package.json`). With nvm, use `nvm install` / `nvm use`; with other managers, install the version in `.node-version`.
- [Rokit **1.2.0**](https://github.com/rojo-rbx/rokit/releases/tag/v1.2.0) to install pinned Rojo/Lune tools. Install it using the upstream instructions and reopen your terminal.
- Roblox Studio for interactive playtesting. The offline tests and builds also run without Studio.

## Create a project

Copy this directory or use it as a GitHub template repository. Exclude generated directories such as `node_modules`, `out`, `include`, `build`, and `.tools`. A GitHub template starts a fresh history; when copying files manually, initialize Git in the destination.

```sh
rokit trust rojo-rbx/rojo lune-org/lune
rokit install
npm ci
npm run init:project -- my-game
npm run doctor
npm run check
npm test
```

To restrict Rojo connections to your published place:

```sh
npm run init:project -- my-game --place-id 123456789
```

The initializer updates package/lockfile names, the README title, and Rojo project name. An optional place ID sets `servePlaceIds`; no place is published. It preserves existing place restrictions when no ID is provided. The production output path stays `build/game.rbxlx` for consistent scripts and CI.

The optional place ID also configures `studio-tools.json` for the Studio CLI. Until configured, the tooling does not automatically select a live place.

## Development

```sh
npm run dev
```

This runs the TypeScript watcher and Rojo together. Both processes stop if either exits or when you press Ctrl+C. Open a Studio place, install the Rojo plugin with `rojo plugin install` if needed, and connect to `localhost:34872`.

The starter performs a protocol-version handshake: the client subscribes, sends readiness, the server queues it, and a simulation tick sets the Jecs readiness tag and acknowledges the client. Output shows `[Game] Session ready ...` once per session.

## Commands

`npm run verify` runs the complete offline check/build suite and writes machine-readable results and logs under `build/verification/`. Use `npm run verify -- --studio <id>` to include automated acceptance in the configured, already-open smoke place. An offline pass explicitly records that Studio was not run. See [verification and smoke automation](docs/verification.md).

The optional [session counter reference](docs/reference-feature.md) demonstrates input, validated bounded commands, Jecs updates, owner-only snapshots and a React view. Its design sources are under `docs/ui/reference-counter/`; disable it through `src/shared/reference-counter-config.ts` when replacing it with game features.

| Command                                   | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                             | Compiler watcher and Rojo, with coordinated shutdown      |
| `npm run watch` / `npm run serve`         | Run either process separately                             |
| `npm run doctor`                          | Check pinned Node, npm, Rojo, and Lune versions           |
| `npm run check`                           | Formatting, lint, and roblox-ts compilation               |
| `npm run lint` / `npm run lint:fix`       | Lint / apply available fixes                              |
| `npm run format` / `npm run format:check` | Format / verify formatting                                |
| `npm test`                                | Build and run TestEZ tests in Luau under Lune             |
| `npm run test:tooling`                    | Run initializer, recovery, and pipeline regression tests  |
| `npm run test:studio`                     | Build and open an isolated smoke place; press Play        |
| `npm run test:studio -- --build-only`     | Build the smoke place without launching Studio            |
| `npm run build:place`                     | Compile and write `build/game.rbxlx`                      |
| `npm run clean`                           | Remove generated output, test places, and compiler caches |

Tool commands resolve project-local `.tools` binaries, then Rokit's user bin directory, then PATH. `.tools` is ignored and is only needed when verifying with portable binaries. `clean` preserves installed dependencies and tools.

## Asset pipelines and specialist agents

Reusable tooling extracted from Monster RNG includes headless Blender jobs, verified artifact caching, bounded batch processing, native animation validation/export, mesh preparation, receipt-based upload capabilities, Studio inspection/source export, reviewed authoring, and owned test/device cleanup. These tools use Node built-ins and add no npm dependencies. See the [tooling guide](docs/tooling.md) for configuration and exact commands, and [validation evidence](docs/tooling-validation.md) for what was tested.

```sh
npm run blender:doctor
npm run blender -- run scripts/blender/examples/companion.json --profile preview
npm run blender:batch -- scripts/blender/examples/batch.json --profile preview --reuse
npm run studio -- studios
npm run test:pipelines
```

Fifteen [project-scoped specialist roles](docs/team.md) cover design, engineering, content, presentation, device diagnosis, independent review and coordination. They inherit session settings and do not transfer Monster RNG's project-specific permissions or launch background work.

Additional [focused verification and review tools](docs/tooling-additions.md) provide scoped source fingerprints, ready Studio verification batches, repeatable visual comparisons, asset inventory and optional owned Rojo serving.

Uploads and live mutations require an appropriate task and configured target. Persistent native edits need project-owned mappings and a saved/exported backup; the game-specific whole-place importer was not copied. `clean` preserves unresolved Studio/upload recovery evidence. Blender recipes and source scenes selected for production belong under durable `assets/`, while `build/` remains scratch.

## Structure

```text
src/client/                 Client entry point and network endpoint
src/server/                 Server entry point, network endpoint, and ECS ownership
src/shared/ecs/             Testable session state, system runner, and TestEZ specs
src/shared/networking.ts    Shared typed protocol
scripts/                    Portable development and template tooling
tests/                      Lune adapter and dedicated Studio smoke scripts
docs/                       Architecture and dependency maintenance
.github/workflows/ci.yml    Windows/Linux checks and place artifacts
```

Jecs owns simulation state. Flamework networking transports commands; services/controllers are optional. Add non-yielding systems in execution order in `src/server/main.server.ts`. In Studio, the system runner records timings and emits MicroProfiler labels; inspect `runner.getTimings()` in the debugger. [Architecture and extension points](docs/architecture.md) explain ownership, lifecycle, validation, replication, and optional UI/persistence packages.

## Tests and CI

Specs are `*.spec.ts` modules that return a TestEZ suite function. `npm test` executes compiled Luau and Jecs inside a built test place loaded by Lune. Test coverage includes readiness coalescing, removal/rejoin, world cleanup, ordered systems, and failures. This adapter does not simulate live networking or the Roblox engine.

For live verification, run `npm run test:studio` and press **Play** in the generated smoke place. Require `[Smoke] PASS` in Output, with no errors. It checks the real handshake, ready ECS entity, and duplicate requests. The command launches an interactive editor and does not itself report a passing runtime test. Stop Play and close the smoke place afterward. It opens a new local test place and does not modify another open project.

The production project excludes specs and the TestEZ implementation. CI runs clean lockfile installs and the full offline verification command on Windows and Linux. Generated places and verification reports are uploaded as artifacts. CI does not execute Studio; local automated acceptance uses an explicitly configured smoke target. CI will start once the repository is hosted on GitHub.

## Maintenance

Use `npm ci` for repeatable installs and commit `package-lock.json`. After compiler/transformer changes, run `npm run clean`, then checks and tests. See [dependency notes](docs/dependency-notes.md) for upstream development dependency advisories and upgrade guidance. Generated files belong in `out`, `include`, and `build`; edit TypeScript in `src`.
