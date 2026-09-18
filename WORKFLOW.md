---
# The Notion adapter owns provider credentials and its concrete schema. These are
# the repository's intended state names once that adapter is configured.
tracker:
  kind: notion
  provider:
    database_url: $LEESH_LOOP_NOTION_DATABASE_URL
  # Backlog is a normal non-dispatch state and therefore intentionally stays
  # outside the active state set below.
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
  # The Operator must set this to a dedicated absolute directory outside this repository.
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  # Symphony executes this only for a newly-created workspace. Continuations use
  # the preserved workspace; Human Review -> Rework is the documented reset exception.
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
    env PATH="$CHATGPT_SHOT_WORKER_INTERFACE_ROOT:$PATH"
    codex
    --config model="gpt-5.6-luna"
    --config model_reasoning_effort="xhigh"
    app-server
---

# Leesh Loop repository workflow

You are working on an Accepted Plan task.

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- Current state: {{ issue.state }}
- URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

{% if attempt %}
This is a Symphony continuation or retry. Reconstruct the current State, Repository Plan, Workpad, and workspace before acting. Preserve the workspace except for the explicit Human Review → Rework reset protocol.
{% endif %}

Read `AGENTS.md`, then apply [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md). The template is the reusable Plan-based execution policy; this file supplies this repository's concrete rules.

## Workspace and task surface

The `after_create` hook clones the configured repository and installs its worker dependencies before the agent starts. Symphony then prepares the production task branch from the exact fetched remote configured base before running `before_run` or starting Codex. The task branch is `SYMPHONY_TASK_BRANCH` (a tracker-provided branch when present, otherwise a stable branch derived from the immutable task identifier) and must differ from `SYMPHONY_GITHUB_BASE_BRANCH`; a base checkout, detached HEAD, stale branch, or branch-preparation failure blocks the worker. Work only in the Symphony-provided workspace. Do not modify `operator/symphony/` unless the Accepted Plan specifically requires it.

The execution environment provides the worker-facing `chatgpt-shot` command.

Use only `chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>`.

Do not start, stop, authenticate, repair, or otherwise manage the external `chatgpt-shot` Service.

Use the Notion task surface for the Accepted Plan, Workpad, and state changes. Write the Workpad in Korean; preserve code, commands, identifiers, paths, API names, and quotations verbatim where accuracy requires it. `notion_task_read_workpad` reads only the complete canonical Workpad of this bound task; use it rather than arbitrary Notion access.

If the task surface itself or its authentication is unavailable, it cannot record a Workpad entry or transition its own state. Do not claim that a same-surface handoff occurred and do not invent a fallback mutation channel. End with the concrete external-access blocker in the worker result. This is an integration/access failure outside normal worker execution, not a repository-defined recovery lifecycle.

## Repository state and delivery

The repository state vocabulary is:

- `Backlog` is a normal non-active, non-terminal waiting state. It is valid for
  storing work before execution approval, but it is never a dispatch candidate.
- `Ready`, `In Progress`, `Rework`, and `Merging` are active states. Move `Ready` work to `In Progress` before implementation; use `Rework` only for the human-selected review-rejection path. `Merging` is only the human-authorized phase for merging the exact delivery from the preceding `Human Review`; it never authorizes general implementation or an arbitrary branch merge.
- `Human Review` is the single non-active, non-terminal human pause state. A human may select `In Progress`, `Rework`, or `Merging` from it. Comments never constitute approval or dispatch. Workers use it after a validated PR, for a human-required blocker, or when independent review cannot continue; record `reason: review` or `reason: blocker` in the Workpad. A worker must never transition a task into `Rework` or `Merging`.
- `Done` and `Cancelled` are terminal states. Move to `Done` only after the approved delivery has actually been merged through its GitHub PR and the resulting remote configured base has been verified. Never use terminal state merely because implementation, verification, independent review, or a successful merge command finished.

## Dispatch reconstruction and live Workpad

Every dispatch—initial, continuation, retry, and either return from Human Review—begins by reading current task State and Accepted Plan, resolving the deterministic Repository Plan, reading `notion_task_read_workpad`, inspecting the actual workspace/Git state, and reconciling the latest relevant markers. State is lifecycle authority; the workspace is concrete repository truth; the Workpad is live execution context; the Repository Plan is the durable execution contract. If Workpad and workspace differ, reconcile from the workspace and write a concise Korean current-state entry when that materially clarifies work. Do not repeat completed work merely because a worker restarted.

Write the Workpad promptly at meaningful milestones: a material approach choice/change, substantial implementation, material finding/constraint, representative validation, review result/disposition/fix, blocker, remaining work, Human Review preparation/entry, Review Input consumption, Rework reset, or Merging result. Do not use it as command-by-command logging. Update the Repository Plan only for material contract changes, never routine execution history.

Use only these lifecycle entries, retaining ordinary context around them:

```text
Human Review
cycle: N
reason: review | blocker
delivered_pr: <PR URL or number | none>
delivered_head: <HEAD | none>
comment_baseline: <comment-id | none>

Human Review Entered
cycle: N

Review Input
cycle: N
mode: continue | rework
from_comment: <comment-id | none>
through_comment: <comment-id | none>

<review input>

Rework Reset Complete
cycle: N
origin_base: <resolved-remote-base-commit>

Merging
cycle: N
approved_pr: <PR URL or number | none>
approved_head: <HEAD | none>
attempt: <not-started | merged | recovered | blocker>
merged_pr: <PR URL or number | none>
merged_head: <HEAD | none>
remote_base: <configured-base remote commit | none>
blocker: <concrete condition | none>
```

Prepare each independent Human Review interval with the next monotonically increasing cycle number (starting at 1), latest comment ID as its baseline, and the delivered PR identity plus current delivered HEAD. Confirm the Workpad append, then transition State to `Human Review`. When the current execution directly receives an explicit State-mutation failure, retry that mutation with the same prepared cycle; do not create another cycle. On State success, append `Human Review Entered` when possible. If the State is observed as `Human Review` with its Entered marker missing, repair that marker when possible and do not dispatch. Missing Entered evidence is not a transaction log: never force an explicitly active `In Progress`, `Rework`, or `Merging` task back to Human Review based on it.

Comments alone never dispatch, mutate State, imply continuation/Rework, or approve a merge. At the first `In Progress` or `Rework` observation after the latest unconsumed Human Review cycle, first reuse an existing `Review Input`; otherwise read provider-ordered comments once, fix `through_comment` to the latest currently visible comment, and append immutable bounded input for `(comment_baseline, through_comment]`. Use `mode: continue` for `In Progress` and `mode: rework` for `Rework`. If a non-`none` baseline cannot be located despite later comments, surface that ambiguity rather than guessing. Retries reuse the same input and never widen it with later comments. `Merging` consumes no Review Input: its authorization is the observed State selected by the human under this lifecycle contract.

`Human Review → In Progress` resumes the preserved workspace, branch, Plan, and valid work after reconciliation. The configured Git target is the Project's `github_repository_url` and `github_base_branch`, exposed as `SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH`; neither may be inferred from the checkout, a default branch, or a fallback branch. `Human Review → Rework` rejects the approach: first materialize `mode: rework`, read the exact latest Repository Plan, fetch the current remote configured base, and check `Rework Reset Complete` for that cycle. If absent, run `git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"`, resolve `refs/remotes/origin/$SYMPHONY_GITHUB_BASE_BRANCH`, recreate implementation state and a fresh task branch from that exact commit, restore the current Plan to `docs/plans/active/<date-summary>.md` (including a Plan currently under `completed/`), append/confirm `Rework Reset Complete` with `origin_base`, and only then implement. Do not reset again when that cycle's marker already exists. If reset/restoration cannot be established, do not dispatch Rework.

`Human Review → Merging` preserves the delivered workspace, branch, and Plan; it must not perform the Rework reset. On every Merging dispatch or retry, reconstruct the current State, Workpad, workspace/Git state, and immediately preceding Human Review cycle before any repository mutation. Establish the Approved delivery from that cycle's `delivered_pr` and `delivered_head`; if either identity cannot be established, record a concrete `Merging` blocker and use the blocker handoff below. This workflow relies on the documented State lifecycle and does not reconstruct or reject arbitrary manual transitions that bypass it.

The production Operator provides the Human Review → Merging approval action through `operator/app/production-operator.mjs approve`. It reads the configured tracker task and current `Human Review` State, reads the delivered PR source HEAD from GitHub, reads the completed independent-review Job target HEAD, requires exact identity equality, records the approved HEAD, transitions to `Merging`, and verifies authoritative readback. Workers and self-verification do not substitute a second approval or mutate Notion State directly. A Merging dispatch re-reads the approved HEAD and current PR source HEAD; a mismatch is stale approval and must transition to `Rework` for a fresh delivery/review/approval cycle.

Before issuing a merge, inspect the Approved delivery through GitHub. If it is not already merged, require that the PR exists, targets the configured base branch, and has the exact approved Delivered HEAD. A changed head is an unreviewed replacement and must not be merged. Use the repository's normal GitHub PR merge path, never a direct push to the configured base branch. After a successful merge operation, fetch the configured base again and independently verify that the merged PR is the Approved delivery, its actual merged/source head is exactly the approved Delivered HEAD, and the GitHub-reported merge result is present on fetched remote configured base. Record the verified merged identity and remote configured-base commit in `Merging`, then transition `Merging → Done` and confirm authoritative State readback.

If the Approved delivery is already merged, do not accept merged status alone. Verify that it is the Delivered PR, its target is the configured base branch, its actual merged/source head equals the approved Delivered HEAD, its resulting merge is present on fetched remote configured base, and no later unreviewed PR head was merged. Only then record `attempt: recovered`; do not attempt a second merge, and complete the same verified `Merging → Done` transition. If the PR is already merged at another head, record both heads and the observed repository state as a blocker; do not transition to `Done`.

For a human-required blocker, including a missing Approved PR or HEAD, a PR base/source-head mismatch, merge conflict, GitHub/auth/access failure, ambiguous merge result, merged identity mismatch, absent merge result on fetched remote configured base, or configured-base fetch/readback failure, record the concrete condition, current repository state, required human action, workspace/validation state, and remaining work; prepare `Human Review` with `reason: blocker`; transition to `Human Review`; confirm authoritative readback; and stop. Do not select an alternate PR, perform an arbitrary repair merge, direct-push the configured base, or choose Rework automatically. A merge failure must never produce `Done`, and merge recovery must never autonomously choose `Rework`. If the Notion surface is unavailable, report that concrete access failure rather than claiming a state transition.

Before starting a new implementation, verify that Symphony prepared the current task branch from the latest configured remote base with `git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"` and `refs/remotes/origin/$SYMPHONY_GITHUB_BASE_BRANCH`; if either operation failed, do not create a task branch from local HEAD or stale state. Work only on `SYMPHONY_TASK_BRANCH`, make only task-related commits, and push only that task branch. Create the delivery PR with an explicit `gh pr create --base "$SYMPHONY_GITHUB_BASE_BRANCH" ...`; never direct-push or direct-merge to the configured base branch. Before recording a Human Review delivery, read the PR back from GitHub and require that it exists, targets the configured base branch, sources the delivered task branch, and currently points at the exact `delivered_head`; otherwise no valid delivery exists. Record its full GitHub URL in the existing `delivered_pr` Workpad marker; keep it `none` until a real PR exists and do not synthesize a placeholder. Preserve that same PR identity for Human Review, review, and merging. Before opening the PR, inspect the final diff and status, run applicable repository checks and `git diff --check`, compare the actual result with the Repository Plan as required by the reusable template, apply any needed durable correction, and move the delivered Plan to `docs/plans/completed/`. That move does not make the task terminal. Record material verification, contract decisions, root causes, and artifact changes as PR comments when a PR exists.

The Operator owns branch bootstrap before dispatch: it validates the configured repository and branch, reads an existing configured base without changing it, or creates a missing configured base from the repository default branch's current remote HEAD and performs an authoritative readback. A missing or unreadable default HEAD, branch creation failure, or readback failure blocks readiness. The default branch is only a bootstrap seed; workspace creation, task branches, Rework, PRs, Merging, and Done verification use the configured base. New workspaces must have `origin` equal to the configured repository, the configured base checked out, and the clone-time configured-base commit as `HEAD`. Continuations preserve their workspace and do not clone or reset it. Legacy `origin_main` is equivalent to `origin_base`, and legacy `main` is equivalent to `remote_base`, only when the configured base branch is exactly `main`; otherwise those legacy markers are not evidence for the current base, and history is not rewritten.

## Independent `chatgpt-shot` review gate

After implementation and ordinary repository verification, obtain the current PR URL and `git rev-parse HEAD`, then submit this request through `chatgpt-shot submit "<prompt>"`. Treat the command's stdout as the Review Job ID, not as the review Result.

```text
PR <PR_URL>의 HEAD <HEAD_SHA>를 코드 리뷰하라.

지정 HEAD의 실제 원문을 확인한 뒤에만 finding을 확정하라. 영향도와 재현 가능성을 기준으로 실제 결함만 보고하라. 개선 가능성, 스타일, 추측, 의도된 동작은 finding이 아니다.

[Additional review criteria:
<criteria explicitly specified by the Accepted Plan>]

각 finding에는 severity, 제목, 파일:줄, 실제 코드 근거, 재현 경로, 영향, 결함인 이유, confidence를 포함하라. 모든 결과는 하나의 Markdown 문서로 출력하라.

형식:
# Verdict
PASS | FINDINGS

# Findings
- [severity] 제목
  - Location:
  - Evidence:
  - Reproduction:
  - Impact:
  - Why defect:
  - Confidence:

finding이 없으면 `# Findings`는 `None.`으로 출력하라.
```

The bracketed block is optional. Include it only when the Accepted Plan explicitly specifies additional review criteria. Do not invent or infer criteria; otherwise omit the block.

After submission succeeds, poll `chatgpt-shot jobs <job-id>` every 30 seconds until the Review Job reaches a terminal State.

- `pending`: wait 30 seconds and poll the same Job again.
- `in_progress`: wait 30 seconds and poll the same Job again.
- `completed`: use the Job's `result` as the independent review Result.
- `failed`: use the existing independent-review blocker handoff described below.

Do not submit another Review Job for the same review target while the current Job is `pending` or `in_progress`.

Give the request enough Accepted Plan and changed-result context to judge the objective, as well as the PR and HEAD identity. Record each review target, Review Job ID, completed Result, finding, evidence-based acceptance or rejection, fix, post-fix verification, and re-review result in the Korean Workpad. Do not copy the full transcript into the Repository Plan.

Treat findings as review input, not automatic edit commands. Independently validate each finding against the current HEAD and its execution path. Fix only a material actionable finding with concrete evidence and observable impact; rerun affected verification, commit/push, and submit a new Review Job for the new HEAD. Record a rejection reason without editing for findings that are not valid. If a completed Review Job targeted the wrong PR, HEAD, or other review identity, correct the review target and submit a new Review Job. Treat this as a new review request, not as retry or recovery of the completed Job. Repeat until the Result is `PASS`, or all findings are resolved/rejected and no accepted fix produced a new HEAD.

If the Review Job reaches `failed`, it has not passed this gate. Record the Job Error and current implementation/verification state in the Korean Workpad, move the task to `Human Review` with `reason: blocker`, confirm authoritative readback, and stop.

If `chatgpt-shot submit` fails before returning a Job ID, use the existing submission-failure blocker handoff: record the failure reason and current implementation/verification state in the Korean Workpad, move the task to `Human Review` with `reason: blocker`, confirm authoritative readback, and stop. Do not create an automatic recovery or failure-code retry policy.

After a passing review gate, move the task to `Human Review` with authoritative readback. A human may return it to `In Progress` or `Rework`; then follow the corresponding continuation/reset contract, perform the required verification and independent review again, and return it to `Human Review`. A human may instead select `Merging`, which follows the approved-delivery merge contract above.

When a task returns from `Human Review` to `Rework`, follow the Rework reset protocol above. This is the same task's non-terminal rework, not a terminal reopen; do not search for a different Plan. Before the next PR handoff, apply the normal final comparison and move it back to `completed/`.
