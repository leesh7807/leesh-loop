# Leesh Loop reusable workflow template

This template is the minimum Plan-based worker policy shared by Leesh Loop repositories. A repository-owned `WORKFLOW.md` supplies its Symphony configuration, workspace setup, tracker states, delivery path, language policy, and review tooling. This file does not replace Symphony orchestration: scheduling, dispatch, retries, continuation, reconciliation, and workspace/session lifecycle remain Symphony core responsibilities.

The concrete upstream `elixir/WORKFLOW.md` in OpenAI Symphony is a useful worker-policy reference only. It is not inherited by Leesh Loop workers.

## Start from the accepted execution input

Treat the task's Accepted Plan as an immutable, correctly published execution input. Do not add a publication preflight, re-prove publication or task-to-Plan binding, or attempt to repair malformed publication/integration from a normal worker run. Those are Publisher, adapter, or integration defects.

Read the Accepted Plan and derive its required H1 identity. A valid identity is its `# <date-summary>` heading. The corresponding active Repository Plan is exactly:

```text
docs/plans/active/<date-summary>.md
```

Do not search for, select, or guess another Plan. If the H1 cannot provide that identity or the expected Repository Plan cannot be used, treat it as an ordinary execution blocker: record the facts in the Workpad and follow the concrete repository workflow's blocker handoff.

## Execute the accepted objective

Use repository evidence and normal engineering judgment to complete the Accepted Plan. Solve ordinary implementation problems autonomously; the actual implementation path may differ from an anticipated one when that is necessary to deliver the accepted objective. Do not absorb meaningful work outside that objective into the task.

Use the repository's intended entry points and its authoritative repository guidance. On a retry or continuation, continue from the workspace Symphony preserved. Do not introduce a separate fresh-workspace or terminal-reopen lifecycle.

## Keep the two task records distinct

The Workpad is mutable execution history. Record progress, investigation, temporary failures, command output, evidence, blockers, review results, fixes, verification, and handoff there.

The Repository Plan is a durable project artifact, not a running log. Before repository handoff, compare it with the actual result. Update it only when the result materially changes the objective, intent, boundary, accepted requirement, important assumption, constraint, or verification method. Do not copy routine history, transient failures, command output, or review transcripts into it.

## Verify and hand off

Verify the representative intended flow through the repository's practical interfaces. Follow the concrete repository workflow for delivery, tracker transitions, review, and handoff. A successful worker run, implementation completion, or ordinary verification completion is not by itself a terminal task transition. The repository may require a non-terminal human handoff or further rework.

Do not define a Leesh Loop-specific human-decision taxonomy, publication-recovery lifecycle, binding checkpoint lifecycle, completion checkpoint lifecycle, or terminal reopen protocol here.
