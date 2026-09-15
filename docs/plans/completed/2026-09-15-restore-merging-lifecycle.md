# 2026-09-15-restore-merging-lifecycle

## Objective

Restore `Merging` as the explicit worker-active phase between human approval in
`Human Review` and terminal `Done`, so `Done` is reachable only after the exact
reviewed PR delivery has been merged and remote `main` has been verified.

## Definitions

`Delivered PR` and `Delivered HEAD` are the PR and exact head recorded for the
immediately preceding `Human Review` cycle. An `Approved delivery` is that pair
when a human changes the task from `Human Review` to `Merging`.

`Merging` is the human-authorized worker phase for that Approved delivery; it is
not general implementation authorization. `Done` is the terminal state after
the Approved delivery is established as merged and present on remote `main`.

## Intent

Human approval must authorize a separately observable merge operation without
requiring the human to merge manually. The handoff must remain bound to the
exact delivery reviewed, including recovery from an interruption after GitHub
has merged that delivery but before the task reached `Done`.

## Decisions

- Configure `Merging` as an active state; preserve `Done` and `Cancelled` as
  terminal states and retain Notion's free-form State property.
- Keep `Human Review` non-active. Only a human selects `In Progress`, `Rework`,
  or `Merging` from it. Workers enter `Human Review` and only transition
  `Merging` to `Done` after verified integration.
- On every Merging dispatch, reconstruct the State, Workpad, workspace, prior
  Human Review cycle, Delivered PR, and Delivered HEAD. Preserve the delivery;
  do not perform the Rework reset.
- Before merge, require the delivered PR to exist, target `main`, and still have
  the approved Delivered HEAD. Merge only through GitHub's PR path.
- Treat an already-merged PR as recovery only if it is the Delivered PR, its
  actual merged/source head equals Delivered HEAD, and that result is on remote
  `main`. A different merged head, changed PR, conflict, ambiguity, or access
  failure is a recorded blocker returned to `Human Review`, never `Rework` or
  `Done`.
- Extend Workpad markers only with the approved delivery, merge result, merged
  identity, and concrete blocker data required to reconstruct this handoff.

## Verification

The loaded workflow exposes `Merging` as active while terminal states remain
unchanged. Its worker contract makes Human Review inert, dispatches Merging
without Rework reset, binds normal merge and interrupted-merge recovery to the
recorded PR/HEAD, verifies remote `main` before `Done`, and sends unsafe or
failed merge conditions back to Human Review as blockers. Existing continuation
and Rework rules remain explicit and unchanged.

## Verification Tools

- Workflow/config loading and Symphony tracker/orchestrator tests verify active
  versus non-active dispatch classification and terminal semantics.
- Targeted workflow-contract assertions inspect the documented Merging handoff,
  normal merge, exact-head recovery, mismatch, and blocker requirements.
- `mix test`, `mix specs.check`, and `git diff --check` verify the affected
  runtime/documentation surface and repository integrity.

## chatgpt-shot review log

- 리뷰한 HEAD: `21be30adf790299ea833fa733cf1eed412ed848c`
- verdict: PASS (`None.`)
- finding: 없음
- 적용한 커밋: 없음
- 검증 결과: `mise exec -- mix test` 327 passed, 6 skipped; `git diff --check` passed
