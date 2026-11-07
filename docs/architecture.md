# Architecture

## Ownership and update order

The server owns gameplay state in Jecs. The client submits intent through Flamework networking. The receiver validates the request and adds bounded work to a queue; systems apply queued changes during the server Heartbeat. Systems run in the array order declared in `src/server/main.server.ts`. Systems must not yield. Async work should finish outside the simulation and enqueue its result for a later tick.

Player lifecycle hooks create/delete session entities. A `PlayerRef` component associates an entity with its player; a `ClientReady` tag marks completion of the starter handshake. `createPlayerSessions` owns the world and can also construct isolated worlds for tests.

Keep a single owner for each state value. React views project confirmed server snapshots into local presentation state. General entity replication, interest filtering, movement interpolation, persistence, and cross-server state are explicit extensions to the starter. Network IDs require a mapping to local entities; independently created worlds cannot assume matching entity IDs.

## Networking

Shared interfaces define the protocol. Flamework generates runtime guards when compiling `createServer` and `createClient`. Side-specific endpoint modules preserve server configuration on the server. Using networking does not require Flamework service/controller decorators or `Flamework.ignite()`.

The starter sends a protocol-version ready command, coalesces repeats per player, then acknowledges it during the simulation step. Future game commands must check permissions and values and apply suitable rate limits. Generated guards validate structure, and do not establish authorization.

## Diagnostics

The system runner adds a system name and traceback to failures and stops the current step before later systems run. Studio profiling surrounds each system with MicroProfiler markers and records last, total, maximum elapsed time and call count. Inspect `runner.getTimings()` in the server debugger. Timing collection is disabled outside Studio by default. There is no per-frame log spam.

## Verification layers

1. Formatting and lint enforce style and supported roblox-ts constructs.
2. Compilation checks types and generates Flamework metadata.
3. TestEZ runs actual compiled Luau and Jecs under Lune using a deserialized test place. The adapter supports only the engine surface needed for these tests; add engine-dependent tests to Studio instead of expanding mocks indiscriminately.
4. A dedicated Studio smoke place runs the real client/server handshake, validates ready ECS state and exercises duplicate commands. It must print `[Smoke] PASS` during Play.
5. Rojo builds the production place with test specs and the TestEZ implementation excluded.

The GitHub Actions workflow runs layers 1–3 and builds both production and smoke places on Windows/Linux. It does not claim to execute Studio. Release publishing is deliberately a separate decision.

## Optional modules

React/React Roblox powers the template UI. Charm for shared UI state, ProfileStore for player persistence, and a cleanup library are optional extensions as resource ownership grows. Keep template code free of production game mechanics, asset IDs, and published place IDs.

## Complete reference path

The optional [session counter](reference-feature.md) uses the session world and runs after readiness. Its receiver validates protocol, active session, revision and cooldown, then coalesces work per player. The system owns Count and sends initial/accepted snapshots to that player; the React view only projects confirmed values. The counter demonstrates owner-only scalar replication rather than a general entity replication framework. Non-yielding simulation, stale-session protection and teardown are covered by service-free specs and the dedicated Studio smoke scenario.

`npm run verify` provides the [machine-readable verification contract](verification.md). Add `-- --studio <id>` for owned native smoke acceptance; offline reports explicitly distinguish an unexecuted Studio test from a pass.
