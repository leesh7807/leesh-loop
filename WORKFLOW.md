---
# Symphony runtime configuration. The tracker binding is deliberately unresolved:
# Leesh Loop's Notion adapter is not implemented, so no unsupported tracker kind,
# provider schema, credential field, or Notion-specific configuration is declared here.
# Add `tracker` configuration only when the adapter defines its supported contract.
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  after_create: |
    git clone https://github.com/leesh7807/leesh-loop.git .
agent:
  max_turns: 20
codex:
  command: codex app-server
---

# Leesh Loop repository workflow

You are working on this accepted task:

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- State: {{ issue.state }}
- URL: {{ issue.url }}

Normalized task description (its first two lines bind the repository Plan materialization path and base commit):

{{ issue.description }}

{% if attempt %}
Follow-up attempt: {{ attempt }}. Inspect durable binding state according to the common workflow; resume or safely complete an interrupted initial binding without resetting the workspace.
{% else %}
Initial invocation. Inspect durable binding state according to the common workflow before implementation.
{% endif %}

Read and follow the repository's `AGENTS.md` before beginning. Its repository-wide rules, including the `symphony/` boundary, authority order, safety requirements, and reporting standard, remain authoritative and are not repeated here.

Apply [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md) as the single common execution contract. Its task-binding, Plan/Workpad, follow-up, human-judgment, and completion rules govern this work.

## Repository execution and verification

The `after_create` hook clones this repository into each fresh Symphony task workspace before the prompt runs. Do not modify `symphony/` unless the accepted task requires Symphony changes.

When the future tracker binding is configured, supply the repository's provider-native non-dispatchable state mapping required by the common workflow.

Use the repository's direct practical verification surfaces for the changed capability: run applicable tests and checks, inspect the final Git diff and status, and review documentation or integration behavior through its intended path. Run `git diff --check` for every change. Record any unavailable real-flow verification precisely in the Workpad.

## Delivery and review

Work in an isolated worktree and task branch. Inspect the final diff and repository status, commit only task-related changes, push the branch, and open a Pull Request targeting `main`; do not merge directly to `main`.

Where the accepted task or repository guidance requires independent review, obtain it after implementation and address material findings before declaring completion. The reusable workflow defines the tracked-task surface for a material decision before a Pull Request exists. For an open Pull Request, also record material verification verdicts, decisions, root causes, and contract or artifact changes as PR comments in accordance with `AGENTS.md`.
