# 2026-09-11-workflow-contracts

## Objective

Define the reusable Leesh Loop Plan-based worker guidance and this repository's executable Symphony `WORKFLOW.md`, while preserving Symphony core orchestration ownership.

## Definitions

**Accepted Plan** is the immutable execution input published to a Notion task and passed to a worker. **Repository Plan** is the durable local artifact corresponding to it. **Workpad** is the mutable execution record. **Human Handoff** is a repository-defined, non-active, non-terminal tracker state. **chatgpt-shot review** is the independent review/fix/re-review gate after normal verification.

## Intent

Workers trust normally published tasks and execute the accepted objective. Symphony owns scheduling, dispatch, retries, continuation, reconciliation, and workspace/session lifecycle. Leesh Loop must provide the worker policy itself rather than assuming OpenAI's concrete upstream workflow is inherited.

## Decisions

- The reusable template contains only common Plan-based execution policy; it excludes repository setup, tracker vocabulary, delivery, language, and review commands.
- The Accepted Plan H1 `# <date-summary>` determines only `docs/plans/active/<date-summary>.md`. A worker never searches for or guesses another Plan; an unidentifiable H1 is an ordinary blocker. A missing deterministic path in a fresh workspace is initialized from the immutable Accepted Plan without overwriting an existing Repository Plan.
- Workpad records execution history. Before handoff, update the Repository Plan only for material durable contract corrections caused by the actual result.
- The root workflow uses Symphony `after_create` to clone this repository and install Node and Elixir dependencies for a fresh workspace. Continuations reuse Symphony's workspace without a reset.
- This repository uses `Ready`, `In Progress`, and `Rework` as active states; `Human Handoff` and `Human Review` as non-terminal handoffs; and `Done`/`Cancelled` as terminal states.
- The root workflow requires Korean Workpad entries and a `chatgpt-shot submit` review/fix/re-review gate. An unsuccessful invocation hands off to `Human Handoff`, not a terminal state.
- After final Plan comparison and before its PR, a delivered Repository Plan moves to `completed/`; that artifact move does not terminalize the tracker task.
- No Publisher change, Symphony source change, publication/binding recovery protocol, completion checkpoint protocol, terminal reopen protocol, or Leesh Loop-specific human-decision taxonomy is introduced.

## Verification

- Review `WORKFLOW.md`, the reusable template, `docs/PLAN.md`, and README against Symphony SPEC for clear ownership and no duplicated orchestration lifecycle.
- Parse the root workflow through Symphony's workflow loader and verify the fresh-workspace hook is present.
- Confirm the Publisher remains unchanged; run its tests and `git diff --check`.
- Create a PR, submit the requested independent review with the current PR/HEAD identity, validate any findings, and log each review round below in this Repository Plan.

## Verification Tools

- Symphony SPEC and workflow loader verify runtime-contract and template syntax boundaries.
- Git history and Publisher tests confirm the merged Publisher baseline remains unchanged.
- `chatgpt-shot submit`, PR readback, Git status, and `git diff --check` provide delivery and independent-review evidence.

## chatgpt-shot review log

### 2026-09-11 round 1

- HEAD `be9ba538d506b8c07b1544530b07d7a6484b42eb`: `FINDINGS`.
- Rejected the unsupported Notion tracker finding because a functioning Notion adapter/task surface is an Accepted Plan premise; replacing it or building one changes scope.
- Accepted the missing fresh-workspace Plan materialization and Plan-completion timing findings. Applied `2e0eb00`; `npm test` (34), workflow parse/render, Symphony workspace/config tests (54), and `git diff --check` passed.

### 2026-09-11 round 2

- HEAD `fa25906052c27f138c2291b0b863b86cfb6d25a8`: `FINDINGS`.
- Accepted deterministic Plan restoration for `Human Review` → `Rework` and moved this delivery Plan to `completed/`. Applied `037eafc`; `git diff --check` passed. Re-review required for the new HEAD.

### 2026-09-11 round 3

- HEAD `f93df4a70fe2cb1df67bbb2573c6d0ad97aa492f`: `FINDINGS`.
- Accepted the unavailable-task-surface correction: only an available surface can perform the required `Human Handoff`; total surface/auth loss is reported as an external integration blocker without claiming an impossible mutation.
- Accepted the review-ledger correction: the compact per-finding ledger in this Repository Plan is now an explicit repository extension, while transcripts and ordinary execution history remain Workpad-only.

### 2026-09-11 round 4

- HEAD `f165215b66ba936e5bca196ff231dd652f430fb1`: `PASS`; no findings.
