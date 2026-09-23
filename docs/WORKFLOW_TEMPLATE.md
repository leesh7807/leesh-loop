# Leesh Loop reusable workflow template

This template is the minimum Plan-based worker policy shared by Leesh Loop repositories. A repository-owned `WORKFLOW.md` supplies its Symphony configuration, workspace setup, tracker states, delivery path, language policy, and review tooling. This file does not replace Symphony orchestration: scheduling, dispatch, retries, continuation, reconciliation, and workspace/session lifecycle remain Symphony core responsibilities.

The concrete upstream `elixir/WORKFLOW.md` in OpenAI Symphony is a useful worker-policy reference only. It is not inherited by Leesh Loop workers.

## Start from the accepted execution input

Treat the task's Accepted Plan as an immutable, correctly published execution input. Do not add a publication preflight, re-prove publication or task-to-Plan binding, or attempt to repair malformed publication/integration from a normal worker run. Those are Publisher, adapter, or integration defects.

Read the Accepted Plan and derive its required H1 identity. A valid identity is its `# <date-summary>` heading. The corresponding active Repository Plan is exactly:

```text
docs/plans/active/<date-summary>.md
```

Do not search for, select, or guess another Plan. If the H1 cannot provide that identity, treat it as an ordinary execution blocker: record the facts in the Workpad and follow the concrete repository workflow's blocker handoff. When the determined Repository Plan is absent in a fresh workspace, create that exact path from the immutable Accepted Plan as its initial durable artifact. Do not overwrite an existing Repository Plan with the Accepted Plan; it may contain a prior material correction.

## Execute the accepted objective

Use repository evidence and normal engineering judgment to complete the Accepted Plan. Solve ordinary implementation problems autonomously; the actual implementation path may differ from an anticipated one when that is necessary to deliver the accepted objective. Do not absorb meaningful work outside that objective.

Use the repository's intended entry points and its authoritative repository guidance. Every dispatch must reconstruct practical current state from current tracker State, the Accepted/Repository Plan, canonical Workpad, and actual workspace. State is lifecycle authority, the workspace is concrete repository truth, the Workpad is live execution context, and the Repository Plan is the durable contract. On a retry or continuation, preserve completed work and reconcile from the workspace rather than restarting it. The configured repository and base branch in the concrete workflow or runtime configuration are authoritative; do not infer them from the checkout, a default branch, or a fallback. Start new implementation work from a fresh task branch based on the fetched current configured base, and do not proceed from local or stale state if it cannot be established.

## Keep the two task records distinct

The Workpad is the mutable live execution surface. Record current approach, meaningful completed progress, material investigation findings, validation results, review state, blockers/uncertainty, and remaining work promptly at meaningful milestones. Do not make it command-by-command logging. A task-bound Workpad read primitive must provide the complete canonical Workpad in provider order and may not allow arbitrary provider-page access; worker-visible read failures must be structured.

The Repository Plan is a durable project artifact, not a running log. Before repository handoff, compare it with the actual result. Update it only when the result materially changes the objective, intent, boundary, accepted requirement, important assumption, constraint, or verification method. Do not copy routine history, transient failures, command output, or review transcripts into it. A repository may require a compact, finding-by-finding independent-review ledger in that task's own Repository Plan; it must contain only the reviewed identity, verdict, disposition, applied commit, and verification summary, never the transcript or general execution history.

## Human Review and rework

`Human Review` is the one non-active, non-terminal state for any human pause: review, blocker, external dependency, or independent-review intervention. Before pausing, record current state and required human action in Workpad, prepare a monotonic Human Review cycle, transition State, and record successful entry when possible. Workpad markers improve ordinary retry/restart behavior but are not a transactional State-mutation history: an absent entered marker must never override an explicit active State.

Each prepared cycle has a fixed comment baseline. At the first `In Progress` or `Rework` observation after that cycle, materialize one immutable `Review Input` entry using comments in the bounded interval through the latest comment visible at first active observation. Comments never dispatch a worker or change State. `In Progress` resumes the preserved workspace and approach. `Rework` rejects that implementation basis: start a fresh task branch from the fetched current configured base and restore the latest Repository Plan before implementation. `Merging` is the human-authorized phase for the Approved delivery from the preceding Human Review; preserve its identity, workspace, and Repository Plan. Keep that approval identity distinct from the merge target, the exact HEAD selected for merge: conflict resolution may change the merge target but does not create a new Approved delivery. Resolve conflicts autonomously when they remain within the approved meaning, scope, and Accepted Plan approach; pause for a separate human decision if resolution changes them. A human-required blocker must move to `Human Review`, not remain intentionally active.

## Verify and hand off

Verify the representative intended flow through the repository's practical interfaces. Follow the concrete repository workflow for delivery, tracker transitions, review, and handoff. A successful worker run, implementation completion, ordinary verification, or merge command is not by itself a terminal task transition. The task may enter its successful terminal state only after the Approved delivery has actually been merged and the resulting remote configured base has been verified; the concrete workflow defines the required readback.

Do not define a Leesh Loop-specific human-decision taxonomy, publication-recovery lifecycle, binding checkpoint lifecycle, completion checkpoint lifecycle, or terminal reopen protocol here.
