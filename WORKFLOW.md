---
# Symphony runtime configuration. The tracker binding is deliberately unresolved:
# Leesh Loop's Notion adapter is not implemented, so no unsupported tracker kind,
# provider schema, credential field, or Notion-specific configuration is declared here.
# Add `tracker` configuration only when the adapter defines its supported contract.
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
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

Normalized task description (its first line must be the repository Plan reference):

{{ issue.description }}

Read and follow the repository's `AGENTS.md` before beginning. Its repository-wide rules, including the `symphony/` boundary, authority order, safety requirements, and reporting standard, remain authoritative and are not repeated here.

## Plan and execution

For each accepted task, read the first line of the rendered normalized task description: `Repository Plan Reference: <repository-relative path>`. The Plan declares that path; Publisher validates it and writes the line during normalization; the adapter carries it unchanged as `issue.description`. Use it to open the one Plan. Do not scan `docs/plans/active/`, infer from a title, or select a Plan by similarity. If the line is absent or malformed, the path is not repository-relative, or it does not resolve to one active Plan, do not begin work or modify another Plan: record and surface the binding blocker.

Treat that referenced Plan as the accepted durable baseline for objective, boundaries, decisions, assumptions, constraints, and verification—not as an immutable implementation script. Apply the common semantics in [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md): adapt to evidence autonomously, retain required additional work in the current task, write durable planning knowledge back to the referenced Plan, and keep transient state in the Workpad.

Do not modify `symphony/` unless the accepted task requires Symphony changes. Do not treat a changed implementation path, a failed attempt, or needed verification refinement as a reason to seek human approval. Return to human judgment only at the template's material decision boundary.

When concrete evidence identifies meaningful work outside the accepted objective, keep it separate. Create a follow-up Plan artifact only when it is independently understandable and judgeable and needs no unresolved material decision. Its future path is normal Plan publication through the Publisher, which validates the follow-up's declared repository Plan reference and writes it into normalized Description; do not assume that this repository currently provides an agent-to-Publisher call, tracker relation mutation, or a Notion adapter.

## Plan lifecycle and verification

Keep the current Plan in `docs/plans/active/` throughout implementation, Pull Request review, and any rework. Correct it during execution only for durable planning knowledge. Do not use it as a work log. Do not move it merely to open a Pull Request. Only after all required review and delivery work is complete, move it unchanged in meaning to `docs/plans/completed/` and transition the task to a terminal state as the same completion operation. If a terminal task reopens, restore the Plan to its original referenced active path before it is dispatchable again.

Use the repository's direct, practical verification surfaces for the changed capability. Run applicable tests, checks, and documentation or integration review; verify the intended primary flow rather than only a synthetic harness. Record commands, intermediate failures, and transient evidence in the Workpad. If real-flow verification is unavailable, complete all safe repository checks and report the precise remaining limit.

## Delivery and review

Work in an isolated worktree and task branch. Inspect the final diff and repository status, commit only task-related changes, push the branch, and open a Pull Request targeting `main`; do not merge directly to `main`.

Where the accepted task or repository guidance requires independent review, obtain it after implementation and address material findings before declaring completion. For an open Pull Request, record material verification verdicts, decisions, root causes, and contract or artifact changes as PR comments in accordance with `AGENTS.md`. Surface any required human decision or unresolved material verification limit in the Pull Request rather than silently deciding it.
