# 2026-09-11-workflow-contracts

## Objective

Define the reusable Leesh Loop Plan-based worker guidance and this repository's executable Symphony `WORKFLOW.md`, while preserving Symphony core orchestration ownership.

## Definitions

**Accepted Plan** is the immutable execution input published to a Notion task and passed to a worker. **Repository Plan** is the durable local artifact corresponding to it. **Workpad** is the mutable execution record. **Human Handoff** is a repository-defined, non-active, non-terminal tracker state. **chatgpt-shot review** is the independent review/fix/re-review gate after normal verification.

## Intent

Workers trust normally published tasks and execute the accepted objective. Symphony owns scheduling, dispatch, retries, continuation, reconciliation, and workspace/session lifecycle. Leesh Loop must provide the worker policy itself rather than assuming OpenAI's concrete upstream workflow is inherited.

## Decisions

- The reusable template contains only common Plan-based execution policy; it excludes repository setup, tracker vocabulary, delivery, language, and review commands.
- The Accepted Plan H1 `# <date-summary>` determines only `docs/plans/active/<date-summary>.md`. A worker never searches for or guesses another Plan; an unusable expected path is an ordinary blocker.
- Workpad records execution history. Before handoff, update the Repository Plan only for material durable contract corrections caused by the actual result.
- The root workflow uses Symphony `after_create` to clone this repository and install Node and Elixir dependencies for a fresh workspace. Continuations reuse Symphony's workspace without a reset.
- This repository uses `Ready`, `In Progress`, and `Rework` as active states; `Human Handoff` and `Human Review` as non-terminal handoffs; and `Done`/`Cancelled` as terminal states.
- The root workflow requires Korean Workpad entries and a `chatgpt-shot submit` review/fix/re-review gate. An unsuccessful invocation hands off to `Human Handoff`, not a terminal state.
- No Publisher change, Symphony source change, publication/binding recovery protocol, completion checkpoint protocol, terminal reopen protocol, or Leesh Loop-specific human-decision taxonomy is introduced.

## Verification

- Review `WORKFLOW.md`, the reusable template, `docs/PLAN.md`, and README against Symphony SPEC for clear ownership and no duplicated orchestration lifecycle.
- Parse the root workflow through Symphony's workflow loader and verify the fresh-workspace hook is present.
- Confirm the Publisher remains unchanged; run its tests and `git diff --check`.
- Create a PR, submit the requested independent review with the current PR/HEAD identity, validate any findings, and log each review round in `docs/PLAN.md`.

## Verification Tools

- Symphony SPEC and workflow loader verify runtime-contract and template syntax boundaries.
- Git history and Publisher tests confirm the merged Publisher baseline remains unchanged.
- `chatgpt-shot submit`, PR readback, Git status, and `git diff --check` provide delivery and independent-review evidence.
