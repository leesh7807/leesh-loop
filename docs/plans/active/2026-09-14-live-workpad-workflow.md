# 2026-09-14-live-workpad-workflow

## Objective

Make the canonical Notion Workpad the live execution surface for a Symphony task across dispatches, retries, continuations, Human Review, and Rework, while retaining task State as lifecycle authority, the Repository Plan as the durable execution contract, and the workspace as concrete repository truth.

## Definitions

**Human Review cycle** is one independently prepared pause interval, identified by a monotonically increasing cycle number in the Workpad.

**Review Input** is the immutable, bounded set of comments materialized once when a reviewed task first becomes active again.

**Rework reset** is the once-per-cycle pre-dispatch reset to fetched `origin/main`, followed by restoration of the latest Repository Plan.

## Intent

Workers need a practical, task-bound read path and a concise, durable operating protocol that lets a new invocation recover useful current context without treating Workpad markers as a transactional provider-state log. Human Review must be the sole human pause state; Rework is the explicit exception to ordinary workspace continuation.

## Decisions

- Add a separately named, task-bound Workpad-read dynamic tool rather than changing the meaning of `notion_task_read`; it reads all canonical child blocks in provider order and returns structured failures through the existing tracker adapter boundary.
- Put workflow reconciliation, milestone recording, Human Review cycle, bounded review-input, blocker, and Rework reset rules in the repository workflow and reusable template. The runner remains state-driven and does not gain a lifecycle journal, comment dispatcher, or separate persistence layer.
- Let current provider State control lifecycle interpretation. Missing Workpad markers never override an explicitly active State; actual workspace state controls concrete Git reconciliation.
- Remove the obsolete separate human-handoff wording and routes. Human-required pauses use `Human Review` and record their reason in the Workpad.

## Verification

Demonstrate the new read operation through the worker-facing dynamic-tool path with complete ordered block content, bound-task enforcement, and structured provider failures. Cover the documented lifecycle protocol in deterministic workflow tests where executable behavior exists, then run targeted Notion/dynamic-tool tests, affected Symphony tests, formatting/spec checks, and `git diff --check`.

## Verification Tools

- `symphony/test/symphony_elixir/notion_agent_tool_test.exs` and `dynamic_tool_test.exs` for the bound provider path.
- Symphony workflow/config and runner tests for state-driven dispatch regression.
- `mix test`, `mix format --check-formatted`, `mix specs.check`, and `git diff --check`.

## chatgpt-shot review log

- Reviewed HEAD: `2c5b1b936a511347e1451583f6ce1321b2e30445`
- Verdict: `PASS`
- Findings: 없음.
- Applied commit: 없음.
- Verification: `chatgpt-shot` Notion Invocation `55b0429c-7900-4ecc-8b84-95ed3ecc89b9` completed with `# Verdict` / `PASS`.

- Reviewed HEAD: `5e87a46769768fa22f60df722b03cf220ce9dee7`
- Verdict: `PASS`
- Findings: `None.`
- Applied commit: 없음.
- Verification: `chatgpt-shot` Notion Invocation `0c6e58ff-db10-40bc-81e1-573171c39003` completed with `# Verdict` / `PASS` and `# Findings` / `None.`.
