# Session counter reference feature

This optional example demonstrates the complete request/state/presentation path without persistent rewards or external assets. It starts enabled in `src/shared/reference-counter-config.ts`; set `REFERENCE_COUNTER_ENABLED` to false to disable both endpoints and mounting. The dedicated counter smoke scenario expects it enabled; revise that scenario when replacing/removing the feature.

## Ownership and flow

1. `src/client/main.client.ts` mounts the counter and subscribes before sending readiness. The React view starts disabled until its initial server snapshot arrives.
2. Button activation sends protocol version and the last confirmed revision. A count doubles as revision because this example only increments by one. The server receives the caller's Player from Flamework; the client cannot choose another player or submit a count to assign.
3. `src/server/ecs/systems/reference-counter.ts` checks protocol and active player membership, then delegates to the service-free counter module. It requires a ready session, a matching bounded revision, no pending command and a 250 ms server cooldown. NaN, infinities, fractions, stale revisions and capped counts fail equality/bounds checks.
4. The Heartbeat runs player sessions before the counter. `src/shared/ecs/reference-counter.ts` owns a Jecs Count component in the session world, initializes ready entities to zero and applies at most one queued increment per player per tick. Queued work captures entity identity so a replacement session cannot inherit it.
5. The system sends an initial snapshot and accepted changes only to the owning player. Clients never receive server entity IDs. The React view displays confirmed values, disables pending actions and allows a retry after two seconds without inventing success. Player departure removes queued work/cooldowns and deletes the session entity; shutdown disconnects endpoints and clears owned state. Client teardown cancels pending timeout, disconnects and unmounts its GUI.

This intentionally demonstrates **owner-only full snapshots** of one scalar. It is not general ECS replication: interest management, public entity identity, deltas, resynchronization and prediction need separate contracts. Count resets on rejoin. Permission checks for real inventory/economy commands must validate their own resources and transactions.

## Design and verification

Concepts and editable HTML live in `docs/ui/reference-counter/`; the native port is `src/client/reference-counter.tsx`. The navy/mint treatment follows the existing loader and the shared presentation guide in `docs/art-direction/README.md` when present. There are connecting, ready, pending, retry and capped states, a 48px action and native activation for mouse/touch/gamepad. No decorative motion or audio is required.

Service-free TestEZ specs cover tick boundaries, initial snapshots, coalescing, cooldowns, stale/invalid requests, session replacement, removal and caps. The native smoke adds actual Flamework transport, React display and calibrated button input. See `docs/verification.md` for exact commands and evidence limits.

Native desktop, portrait and landscape checks passed with viewport assertions and captures under `docs/ui/reference-counter/evidence/`; the selected card clears movement controls. StarterGui uses sensor orientation to permit portrait. During implementation the HTML preview transport was unavailable and file navigation was blocked by browser policy, so matched HTML/native comparison remains unverified. See the evidence notes for exact scope, commands and remaining visual checks.
