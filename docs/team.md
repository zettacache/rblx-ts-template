# Reusable project agents

The project-scoped roles in `.codex/agents/` are adapted from Monster RNG's useful specialist boundaries. They inherit the current model and permissions for portability. They do not copy its product decisions, model preferences, historical authorizations, worktree names or external chat permissions. A role definition does not launch an agent or expand a task's scope.

| Role                      | Assignment                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `development_coordinator` | Scope, file ownership, dependencies, integration and evidence  |
| `gameplay_engineer`       | Jecs simulation, server authority and network command handling |
| `tooling_engineer`        | CLI, build, asset transport, journals and recovery             |
| `pipeline_reviewer`       | Independent read-only reliability review                       |
| `qa_lead`                 | Risk-based checks, reproduction and cleanup                    |
| `blender_artist`          | Editable geometry, rigs, animation and render iteration        |
| `art_director`            | References, silhouettes, materials, visual acceptance          |
| `ui_ux_designer`          | Reading order, responsive UI and native visual review          |
| `lead_game_designer`      | Player problems, bounded briefs and observable acceptance      |
| `systems_designer`        | Reproducible progression, combat, RNG and economy analysis     |
| `audio_vfx_designer`      | Coherent feedback, reduced motion, audio and performance       |
| `level_designer`          | Editable environments, navigation and layout review            |
| `device_test_specialist`  | Native input/device diagnosis, capture and restoration         |
| `monster_designer`        | Collectible/companion art and content integration              |
| `guardian_designer`       | Enemy art, content and encounter presentation                  |

The last two names identify optional content lanes and do not prescribe the game's genre. The roles inherit session settings and only execute assigned work. Use the [compact briefs and decision records](team/templates.md) and [team behavior probes](team/scenarios.md) when useful; these complement the existing assignment and evidence handoffs below.

Files follow the [official custom-agent format](https://learn.chatgpt.com/docs/agent-configuration/subagents). Fresh project sessions can discover these roles. Existing sessions may need to restart/reload before they appear; installing TOML files does not prove a custom role has run.

## Assignment brief

```text
Outcome and task type: analysis / implementation / verification
Checkout and base revision (or content hashes):
Owned files/assets; shared files owned by someone else:
Selected references and current decisions:
Acceptance criteria:
Commands and evidence directory:
Studio target, operation owner and cleanup responsibilities (if needed):
Unverified boundaries and required handoff:
```

Use one writer per file or binary asset. A coordinator owns combined acceptance. Keep small tasks local; request bounded specialization when authorized and useful. A role's read-only instruction is a behavioral boundary, not an independent OS sandbox. Preserve the current user's authorization and active session rules.

## Evidence handoff

Record changed paths, inspected snapshot, exact commands/results, artifact/receipt paths, current Blender or Studio views where relevant, cleanup status and remaining gaps. Distinguish mocks, Blender renders, native Studio screenshots and real gameplay tests. Save the selected concept references and implementation brief alongside their editable assets. A historical pass does not establish current acceptance.
