---
# This repository-owned workflow keeps the production tracker and worker contract
# while omitting external review-service setup from the default E2E runtime.
tracker:
  kind: notion
  provider:
    database_url: $LEESH_LOOP_NOTION_DATABASE_URL
  active_states:
    - Ready
    - In Progress
    - Rework
    - Merging
  terminal_states:
    - Done
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    : "${SYMPHONY_GITHUB_REPOSITORY_URL:?SYMPHONY_GITHUB_REPOSITORY_URL is required}"
    : "${SYMPHONY_GITHUB_BASE_BRANCH:?SYMPHONY_GITHUB_BASE_BRANCH is required}"
    git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .
    node operator/app/workspace-files.mjs "$PWD"
    (cd operator/notion_publisher && npm ci)
    if command -v mise >/dev/null 2>&1; then
      (cd operator/symphony && mise trust && mise exec -- mix deps.get)
    else
      (cd operator/symphony && mix deps.get)
    fi
agent:
  max_turns: 20
codex:
  command: >-
    codex
    --config model="gpt-5.6-luna"
    --config model_reasoning_effort="xhigh"
    app-server
---

# Leesh Loop E2E repository workflow

You are working on an issue from the configured tracker.

* Identifier: {{ issue.identifier }}
* Title: {{ issue.title }}
* Current state: {{ issue.state }}
* URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

{% if attempt %}

This is a Symphony continuation or retry. Reconstruct the current State, Repository Plan, Workpad,
and workspace before acting. Preserve the workspace except for the explicit Human Review → Rework
reset protocol.

{% endif %}

Read `AGENTS.md`, then apply [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md). The template
is the reusable Plan-based execution policy; this file supplies the repository's tracker, workspace,
bootstrap, and Codex execution settings. The E2E workload boundary below is an explicit exception to
the template's H1 identity rule.

## E2E workload boundary

Treat the Accepted Plan supplied by the bound task as the immutable workload. A provided E2E Plan is
valid when it is a readable, non-empty UTF-8 document; it does not need a Markdown H1 or a matching
`docs/plans/active/<date-summary>.md` path. If a provided Plan has no H1, do not turn that into a
blocker, derive another Plan, or rewrite the Accepted Plan. Execute the task from the complete
Accepted Plan using the normal repository and tracker lifecycle. Catalog workloads may contain the
existing run-specific H1 materialization, but that materialization is not a requirement for provided
workloads.

## Workspace and task surface

The `after_create` hook clones the configured repository and installs worker dependencies before the
agent starts. Work only in the Symphony-provided workspace. Do not modify `operator/symphony/` unless
the Accepted Plan specifically requires it.

Use the Notion task surface for the Accepted Plan, Workpad, and state changes. Write the Workpad in
Korean; preserve code, commands, identifiers, paths, API names, and quotations verbatim where
accuracy requires it.

If the task surface or its authentication is unavailable, record the concrete external-access
blocker in the worker result. Do not claim a same-surface handoff or invent a fallback mutation
channel.

## Worker task follow-up capabilities

The bound Notion worker session exposes two independent, limited capabilities:

* `notion_task_publish_plan` accepts complete Plan text and publishes a new canonical task through
  the existing Publisher path with final State `Backlog`. The Publisher owns database binding,
  canonical task/Plan representation, Identifier, Plan relation/content, locking, incomplete-
  publication handling, and validation. The result returns the canonical `identifier` and `page_id`.
* `notion_task_add_blocked_by` accepts a canonical blocker page identity and adds it to the bound
  task's `Blocked By` relation, preserving existing blockers.

These are separate operations. Publication does not modify the current task relation, and the
relation operation does not publish or edit Plan content. The current task is determined by runtime
binding; no arbitrary target-task or general Notion management API is available.

## State and delivery contract

`Backlog` is a normal non-active waiting state. `Ready`, `In Progress`, `Rework`, and `Merging` are
active states. `Human Review` is the human pause state, and `Done` and `Cancelled` are terminal.
Comments do not approve work or dispatch a task. A worker must not select `Rework` or `Merging`.

Every dispatch begins by reading current State, Accepted Plan, Workpad, Repository Plan, and the
actual workspace/Git state. Reconstruct the current state after a continuation or retry and do not
repeat completed work merely because the process restarted.

Before implementation, fetch and resolve the configured remote base branch named by
`SYMPHONY_GITHUB_BASE_BRANCH`. Create task branches from that exact commit and use the configured
`SYMPHONY_GITHUB_REPOSITORY_URL` and base branch for the task workspace and delivery PR. Never infer
the target from the checkout, a default branch, or `main`.

Work against the repository according to the Accepted Plan and repository guidance. Keep plans under
`docs/plans/active/` during execution and move the delivered plan to `docs/plans/completed/` only
after the final comparison and applicable checks pass. Make only task-related commits and never
direct-push the configured base branch.

Prepare a validated delivery for Human Review with the actual PR URL and exact current source HEAD.
The PR must target the configured base branch and must contain the Accepted Plan result. A human may
select continuation, Rework, or Merging from Human Review. Rework recreates implementation state
from the current configured base under the documented reset protocol; Merging preserves the approved
delivery and may resolve conflicts only within its approved meaning.

Move to `Done` only after the approved delivery has actually merged through its GitHub PR and the
resulting remote configured base has been independently read back. A failed validation, missing
delivery identity, GitHub failure, merge ambiguity, or configured-base readback failure is a blocker
that remains in evidence and must not be converted into success. Preserve the task and workspace
state needed for the next human decision.

Record material approach changes, validation results, blockers, delivery identity, and final state
in the Korean Workpad. Keep the production tracker, repository, workspace, and Codex runtime as the
authorities for their respective state; do not invent a parallel lifecycle or task representation.

Every dispatch begins by reading current State and Accepted Plan, the Workpad, the Repository Plan,
and actual workspace/Git state. State is lifecycle authority, the workspace is repository truth, the
Workpad is live execution context, and the Repository Plan is the durable execution contract. On a
continuation, preserve the workspace and reconcile from it rather than repeating completed work.

Use these lifecycle rules:

* Move `Ready` to `In Progress` before implementation. Keep `Backlog` non-dispatchable.
* Use `Human Review` for a validated delivery or a human-required blocker. Prepare it with the
  current PR URL/identity and exact source HEAD; a worker never treats comments as approval.
* `Human Review → In Progress` preserves the workspace and branch after reconciliation. `Human
  Review → Rework` uses the documented configured-base reset protocol. `Human Review → Merging`
  preserves the approved delivery and may resolve conflicts only within that approved meaning.
* Before merging, verify the approved PR, configured base, approved source HEAD, merge result, and
  fetched configured-base readback. Record any mismatch as a blocker; never select an alternate PR
  or direct-push the base.
* Move to `Done` only after the approved PR is merged and the resulting configured base is verified.
  A validation, GitHub, merge, or readback failure remains a failure/blocker and is not converted to
  success.

Before implementation, fetch and resolve the configured remote base with
`git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"`. New workspaces must clone
`SYMPHONY_GITHUB_REPOSITORY_URL` at that configured base and continuations preserve their existing
workspace. Legacy default-branch assumptions are not evidence for a configured target.
