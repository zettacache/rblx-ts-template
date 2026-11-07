# Team briefs and decision records

Use the smallest format that makes the work unambiguous. Do not demand every
field for a routine fix.

## Design brief

```text
Outcome / player problem:
Request type: analysis | design | implementation | verification
Current owner authority and relevant confirmed decisions:
Observed evidence (revision, paths, captures or research):
Recommended direction and decisive tradeoff:
Scope / explicit non-goals:
Player flow, including failure/recovery and phone use:
Protected behavior and source contracts:
Acceptance criteria (observable):
Smallest useful experiment / evidence still needed:
Consequential open decision, if any, with recommended option:
```

A design recommendation remains a proposal until existing authorization covers
implementation. A request to implement a selected design needs no repeated
permission for necessary routine work.

## Delegated work

Use the [project assignment brief](../team.md#assignment-brief)
and the relevant role. Add only:

```text
Team role / reason for authorized delegation:
Exact brief and selected references:
Allowed decision latitude:
Parent/coordinator and immediate return condition:
```

For a helper without shared history include the essential owner decisions, exact
worktree/base, file allowlist, read-only dependencies, acceptance and evidence path.
Supply current failures/attempts for escalation. A parent's Studio reservation is
not transferred. New delegation stays within the assignment and available slots.

## Small delivery ledger

Keep this in the task's existing handoff for substantial work:

| Work item                   | Owner / worktree | Exact files        | Dependency          | State                                                             | Evidence / next step |
| --------------------------- | ---------------- | ------------------ | ------------------- | ----------------------------------------------------------------- | -------------------- |
| Fill from actual assignment | Assigned role    | Explicit allowlist | Actual prerequisite | Proposed / assigned / implementing / review / verified / deferred | Path or action       |

Do not mark verified because a worker said done. Coordinator review and the
relevant checks determine the evidence status. Independent QA and human owner
acceptance are separate facts.

## Consequential decision record

```text
ID / date / subject:
Status: owner-confirmed | verified implementation | working assumption | proposal | unknown | superseded
Decision or hypothesis:
Authority/source (owner instruction, assigned latitude or observed implementation):
Reason and decisive tradeoff:
Alternatives rejected and why, if useful:
Affected brief/config/asset paths:
Acceptance evidence and limits:
Supersedes / superseded by:
Owner action still needed, if any:
```

Keep records beside the subject; link rather than copy them across documents.
Never mark a specialist's opinion owner-confirmed.

## Completion

Use the assignment and evidence formats in docs/team.md. A concise user-facing
handoff says what changed, how it was verified, remaining gaps and exact artifact
paths. Include current inline visual evidence where applicable and distinguish
concepts, Blender renders, Studio Edit and playtest images. Include a suggested
commit message if changes remain uncommitted. Do not claim publication, deployment
or game acceptance from installing these team definitions.
