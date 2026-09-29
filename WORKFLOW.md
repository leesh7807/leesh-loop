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
  command: |
    env PATH="$CHATGPT_SHOT_WORKER_INTERFACE_ROOT:$PATH" bash -c '
      codex_args=()
      if [ -n "${SYMPHONY_CODEX_MODEL:-}" ]; then
        codex_args+=(--config "model=${SYMPHONY_CODEX_MODEL}")
      fi
      if [ -n "${SYMPHONY_CODEX_REASONING_EFFORT:-}" ]; then
        codex_args+=(--config "model_reasoning_effort=${SYMPHONY_CODEX_REASONING_EFFORT}")
      fi
      exec codex "${codex_args[@]}" app-server
    '
---

# Leesh Loop repository workflow

You are working on an Accepted Plan task.

* Identifier: {{ issue.identifier }}
* Title: {{ issue.title }}
* Current state: {{ issue.state }}
* URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

{% if attempt %}

This is a Symphony continuation or retry. Reconstruct the current State, Repository Plan, Workpad, and workspace before acting. Preserve the workspace except for the explicit Human Review → Rework reset protocol.

{% endif %}

Read `AGENTS.md`, then apply [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md). The template is the reusable Plan-based execution policy; this file supplies this repository's concrete rules.

## Workspace and task surface

The `after_create` hook clones the configured repository and installs its worker dependencies before the agent starts. Work only in the Symphony-provided workspace. Do not modify `operator/symphony/` unless the Accepted Plan specifically requires it.

The execution environment provides the worker-facing `chatgpt-shot` command.

Use only `chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>`.

Do not start, stop, authenticate, repair, or otherwise manage the external `chatgpt-shot` Service.

Use the Notion task surface for the Accepted Plan, Workpad, and state changes. Write the Workpad in Korean; preserve code, commands, identifiers, paths, API names, and quotations verbatim where accuracy requires it. `notion_task_read_workpad` reads only the complete canonical Workpad of this bound task; use it rather than arbitrary Notion access.

If the task surface itself or its authentication is unavailable, it cannot record a Workpad entry or transition its own state. Do not claim that a same-surface handoff occurred and do not invent a fallback mutation channel. End with the concrete external-access blocker in the worker result. This is an integration/access failure outside normal worker execution, not a repository-defined recovery lifecycle.

## Worker task follow-up capabilities

The bound Notion worker session exposes two independent, limited capabilities:

* `notion_task_publish_plan` accepts complete Plan text and publishes a new canonical task through the existing Publisher path with final State `Backlog`. The Publisher remains responsible for database binding, canonical task/Plan representation, Identifier, Plan relation/content, locking, incomplete-publication handling, and publication validation. The result returns the new task's canonical `identifier` and `page_id`.
* `notion_task_add_blocked_by` accepts a canonical blocker page identity and adds it to the `Blocked By` relation of the task bound to the current runtime. The operation reads and preserves existing blockers before its additive update.

These capabilities are separate operations. Publication does not modify the current task relation, and the `Blocked By` capability does not publish or edit Plan content. The current task is determined by the runtime binding, not by worker input; no target-task argument or arbitrary Notion management API is exposed. A request that cannot be completed by the corresponding Publisher or relation operation is returned as a failure without worker-side retry or fallback.

## Repository state and delivery

The repository state vocabulary is:

* `Backlog` is a normal non-active, non-terminal waiting state. It is valid for storing work before execution approval, but it is never a dispatch candidate.

* `Ready`, `In Progress`, `Rework`, and `Merging` are active states. Move `Ready` work to `In Progress` before implementation; use `Rework` only for the human-selected review-rejection path. `Merging` is only the human-authorized phase for merging the Approved delivery from the preceding `Human Review`, including permitted conflict resolution to that cycle's recorded Merge target HEAD; it never authorizes general implementation or an arbitrary branch merge.

* `Human Review` is the single non-active, non-terminal human pause state. A human may select `In Progress`, `Rework`, or `Merging` from it. Comments never constitute approval or dispatch. Workers use it after a validated PR, for a human-required blocker, or when independent review cannot continue; record `reason: review` or `reason: blocker` in the Workpad. A worker must never transition a task into `Rework` or `Merging`.

* `Done` and `Cancelled` are terminal states. Move to `Done` only after the approved delivery has actually been merged through its GitHub PR and the resulting remote configured base has been verified. Never use terminal state merely because implementation, verification, independent review, or a successful merge command finished.

## Dispatch reconstruction and live Workpad

Every dispatch—initial, continuation, retry, and either return from Human Review—begins by reading current task State and Accepted Plan, resolving the deterministic Repository Plan, reading `notion_task_read_workpad`, inspecting the actual workspace/Git state, and reconciling the latest relevant markers. State is lifecycle authority; the workspace is concrete repository truth; the Workpad is live execution context; the Repository Plan is the durable execution contract. If Workpad and workspace differ, reconcile from the workspace and write a concise Korean current-state entry when that materially clarifies work. Do not repeat completed work merely because a worker restarted.

If reconstruction shows that the previous execution yielded to a `Blocked By` dependency and the same active task is now dispatched again with its preserved workspace, treat it as a blocked-work continuation. Before continuing implementation, fetch the latest configured remote base and rebase the preserved task branch onto it; resolve rebase conflicts under the same semantic authority boundary as Merging conflict resolution.

Write the Workpad promptly at meaningful milestones: a material approach choice/change, substantial implementation, material finding/constraint, representative validation, review result/disposition/fix, blocker, remaining work, Human Review preparation/entry, Review Input consumption, Rework reset, or Merging result. Keep it concise and concrete in Korean so the completed work, decisions, verification, current state, blockers, and next work are clear before lifecycle details. Lead with the work, result, decision, or remaining task; use files, functions, types, and internal abstractions as supporting detail when useful. Avoid repeating facts or narrating commands. Preserve required markers and exact identities as protocol metadata alongside ordinary context; do not let marker names or workflow explanations replace the task record, and do not add a fixed format. Update the Repository Plan only for material contract changes, never routine execution history.

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
merge_target_head: <HEAD | none>
attempt: <not-started | merged | recovered | blocker>
merged_pr: <PR URL or number | none>
merged_head: <HEAD | none>
remote_base: <configured-base remote commit | none>
blocker: <concrete condition | none>
```

Prepare each independent Human Review interval with the next monotonically increasing cycle number (starting at 1), latest comment ID as its baseline, and the delivered PR identity plus current delivered HEAD. For a Human Review prepared from a Merging blocker, preserve that cycle's `approved_pr` and `approved_head` as `delivered_pr` and `delivered_head`; record any conflict-resolution HEAD that failed or remains unresolved only in the Merging blocker/current-state evidence, never as a new approved delivery. Confirm the Workpad append, then transition State to `Human Review`. When the current execution directly receives an explicit State-mutation failure, retry that mutation with the same prepared cycle; do not create another cycle. On State success, append `Human Review Entered` when possible. If the State is observed as `Human Review` with its Entered marker missing, repair that marker when possible and do not dispatch. Missing Entered evidence is not a transaction log: never force an explicitly active `In Progress`, `Rework`, or `Merging` task back to Human Review based on it.

Comments alone never dispatch, mutate State, imply continuation/Rework, or approve a merge. At the first `In Progress` or `Rework` observation after the latest unconsumed Human Review cycle, first reuse an existing `Review Input`; otherwise read provider-ordered comments once, fix `through_comment` to the latest currently visible comment, and append immutable bounded input for `(comment_baseline, through_comment]`. Use `mode: continue` for `In Progress` and `mode: rework` for `Rework`. If a non-`none` baseline cannot be located despite later comments, surface that ambiguity rather than guessing. Retries reuse the same input and never widen it with later comments. `Merging` consumes no Review Input: its authorization is the observed State selected by the human under this lifecycle contract.

`Human Review → In Progress` resumes the preserved workspace, branch, Plan, and valid work after reconciliation. The configured Git target is the Project's `github_repository_url` and `github_base_branch`, exposed as `SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH`; neither may be inferred from the checkout, a default branch, or a fallback branch. `Human Review → Rework` rejects the approach: first materialize `mode: rework`, read the exact latest Repository Plan, fetch the current remote configured base, and check `Rework Reset Complete` for that cycle. If absent, run `git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"`, resolve `refs/remotes/origin/$SYMPHONY_GITHUB_BASE_BRANCH`, recreate implementation state and a fresh task branch from that exact commit, restore the current Plan to `docs/plans/active/<date-summary>.md` (including a Plan currently under `completed/`), append/confirm `Rework Reset Complete` with `origin_base`, and only then implement. Do not reset again when that cycle's marker already exists. If reset/restoration cannot be established, do not dispatch Rework.

`Human Review → Merging` preserves the delivered workspace, branch, and Plan; it must not perform the Rework reset. On every Merging dispatch or retry, reconstruct the current State, Workpad, workspace/Git state, and immediately preceding Human Review cycle before any repository mutation. Establish the Approved delivery from that cycle's `delivered_pr` and `delivered_head`; these are the approved PR and Approved HEAD for the cycle. If either identity cannot be established, record a concrete `Merging` blocker and use the blocker handoff below. This workflow relies on the documented State lifecycle and does not reconstruct or reject arbitrary manual transitions that bypass it.

Before issuing a merge, inspect the Approved delivery through GitHub. If it is not already merged, require that the PR exists, is the Approved PR, and targets the configured base branch. When this Merging cycle has no recorded `merge_target_head`, require the current PR head to equal the Approved HEAD before any conflict-resolution mutation; when a `merge_target_head` is already recorded, require the current PR head to equal that target and do not treat another head as a new target. If the PR is conflict-free, set `merge_target_head` to the Approved HEAD before merging. If a merge conflict is reported, the Merging worker must first attempt to resolve it by integrating the latest configured base within the Approved delivery's approved meaning, externally observable behavior, contract, scope, and Accepted Plan approach. A conflict is not by itself a Human Review blocker, and the worker may update the PR branch/HEAD as needed for that resolution. Choosing how to reconcile overlapping edits, including changing code or creating a resolution commit, is part of that conflict resolution and is not by itself a separate approval decision. If the worker determines that resolution instead requires a separate decision that materially changes the Approved delivery's approved meaning, externally observable behavior, contract, scope, or Accepted Plan approach, it must stop and use the Human Review blocker path. After resolution, rerun the applicable repository validation/checks, `git diff --check`, the existing Accepted Plan/Repository Plan final comparison, and the existing Merging PR/merge/readback checks; conflict resolution alone does not reopen an independent `chatgpt-shot` review gate. When those checks pass, record the exact resulting HEAD as `merge_target_head` for this Merging cycle before issuing the merge. Re-read the PR immediately before merging and require that it is still the Approved PR, targets the configured base branch, and has exactly `merge_target_head`; a later or different head is not automatically authorized. Use the repository's normal GitHub PR merge path, never a direct push to the configured base branch. After a successful merge operation, fetch the configured base again and independently verify that the merged PR is the Approved delivery, its actual merged/source head is exactly `merge_target_head`, and the GitHub-reported merge result is present on fetched remote configured base. Record `approved_head`, `merge_target_head`, the verified merged identity and `merged_head`, and the remote configured-base commit in `Merging`, then transition `Merging → Done` and confirm authoritative State readback.

If the Approved delivery is already merged, do not accept merged status alone. Verify that it is the Approved PR, its target is the configured base branch, and its actual merged/source head equals the current cycle's recorded `merge_target_head`. If no `merge_target_head` was recorded, first require that the actual merged/source head equals the Approved HEAD and record `merge_target_head` as the Approved HEAD; a differing head has an unestablished merged identity and is a blocker. Also verify that the resulting merge is present on fetched remote configured base and no later unreviewed PR head was merged. Only then record `attempt: recovered`; do not attempt a second merge, and complete the same verified `Merging → Done` transition. If the PR is already merged at a head different from `merge_target_head`, record both heads and the observed repository state as a blocker; do not transition to `Done`.

For a human-required blocker, including a missing Approved PR or HEAD, a PR base/source-head mismatch, an unresolved conflict after the Merging worker's permitted resolution attempt, a determination that resolution requires a separate decision outside the Merging authority, a required validation failure, GitHub/auth/access failure, ambiguous merge result, merged identity mismatch, absent merge result on fetched remote configured base, or configured-base fetch/readback failure, record the concrete condition, current repository state, required human action, workspace/validation state, and remaining work; when this blocker returns the task to Human Review, preserve the preceding Merging cycle's Approved PR and Approved HEAD as the delivered identity rather than promoting a changed resolution HEAD; prepare `Human Review` with `reason: blocker`; transition to `Human Review`; confirm authoritative readback; and stop. Do not select an alternate PR, promote a later PR HEAD after `merge_target_head` is fixed, perform an arbitrary repair merge, direct-push the configured base, or choose Rework automatically. A merge failure must never produce `Done`, and merge recovery must never autonomously choose `Rework`. If the Notion surface is unavailable, report that concrete access failure rather than claiming a state transition.

Before starting a new implementation, fetch the latest configured remote base with `git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"` and resolve `refs/remotes/origin/$SYMPHONY_GITHUB_BASE_BRANCH`; if either operation fails, do not create a task branch from local HEAD or stale state. Create the task branch from that exact commit, make only task-related commits, and push only the task branch. Create the delivery PR with an explicit `gh pr create --base "$SYMPHONY_GITHUB_BASE_BRANCH" ...`; never direct-push or direct-merge to the configured base branch. Before recording a Human Review delivery, read the PR back from GitHub and require that it exists, targets the configured base branch, sources the delivered task branch, and currently points at the exact `delivered_head`; otherwise no valid delivery exists. Record its full GitHub URL in the existing `delivered_pr` Workpad marker; keep it `none` until a real PR exists and do not synthesize a placeholder. Preserve that same PR identity for Human Review, review, and merging. Before opening the PR, inspect the final diff and status, run applicable repository checks and `git diff --check`, compare the actual result with the Repository Plan as required by the reusable template, apply any needed durable correction, and move the delivered Plan to `docs/plans/completed/`. That move does not make the task terminal. Record material verification, contract decisions, root causes, and artifact changes as PR comments when a PR exists.

The Operator owns branch bootstrap before dispatch: it validates the configured repository and branch, reads an existing configured base without changing it, or creates a missing configured base from the repository default branch's current remote HEAD and performs an authoritative readback. A missing or unreadable default HEAD, branch creation failure, or readback failure blocks readiness. The default branch is only a bootstrap seed; workspace creation, task branches, Rework, PRs, Merging, and Done verification use the configured base. New workspaces must have `origin` equal to the configured repository, the configured base checked out, and the clone-time configured-base commit as `HEAD`. Continuations preserve their workspace and do not clone or reset it. Legacy `origin_main` is equivalent to `origin_base`, and legacy `main` is equivalent to `remote_base`, only when the configured base branch is exactly `main`; otherwise those legacy markers are not evidence for the current base, and history is not rewritten.

## Independent `chatgpt-shot` review gate

Apply the common code and structure review contract in `docs/WORKFLOW_TEMPLATE.md`, including exact PR/HEAD binding, Job polling, failure handoff, finding disposition, and restarting review after a fix changes HEAD. Add review criteria only when the Accepted Plan explicitly specifies them. This workflow keeps repository-specific State, Human Review, Rework, and Merging rules in their sections above.

## Review and publish a follow-up Plan

When work reveals a follow-up task, write a complete Candidate Plan using `docs/PLAN.md`. Before publication, submit the request below through the existing `chatgpt-shot` review flow. The Candidate Plan is a proposal, not an accepted contract; include the entire Plan and only the current work context needed to judge it. Base that context on the current Accepted Plan and observed work, not claims introduced by the Candidate Plan. Include a PR as evidence when one exists, but do not delay review or create a temporary PR when none exists.

```text
Review the complete Candidate Plan below as a proposal, not as an Accepted Plan. Review its Objective, Intent, and Verification Requirements as the planning contract itself against the supplied current work context and evidence.

Find only material omissions or distortions of the current objective, missing guarantees, unnecessary constraints or complexity, or verification gaps that could lead a reasonable implementation to a materially different result or count a failure as success. Focus on the intended execution path and observable evidence. Apply KISS, YAGNI, and DRY. Do not flag ordinary implementation choices that converge under existing repository contracts or conventions, or simple unresolved choices best left to implementation. Do not treat claims made only by the Candidate Plan as evidence.

Return PASS or findings. For each finding, state the affected contract, concrete evidence, and material consequence. If the supplied context does not establish a material problem, do not invent one.

Current work context:
Current objective: <related goal, intent, or boundary from the current Accepted Plan>
Observed result: <actual result that prompted the follow-up>
Follow-up boundary: <what the current task handled and what remains for the follow-up>
User requirement: <user-stated requirement that grounds this follow-up, or none>
Evidence: <PR URL, exact HEAD, artifact, or concrete observation; none if absent>

Candidate Plan:
<complete Candidate Plan>
```

Reuse the independent review flow in `docs/WORKFLOW_TEMPLATE.md` for submission, polling, terminal results, failure handoff, and evidence-based finding disposition; do not add a Plan-specific Job lifecycle or recovery rule. Incorporate only valid findings. If a valid finding materially changes the Candidate Plan, review the revised complete Plan again. Do not publish unless review is complete and no valid finding remains.

Record the Candidate Plan identity, Review Job ID and result, and finding dispositions in ordinary Workpad context. Do not copy the prompt transcript or label a review as targeting a PR or HEAD when none was submitted.

After review, publish the complete Candidate Plan with `notion_task_publish_plan` and retain its returned canonical `identifier` and `page_id`. Before calling `notion_task_add_blocked_by` with that `page_id`, record the review disposition, published identity, and that the current task is yielding to that blocker in the Workpad, then finish other needed recording and cleanup. A successful relation update is the current execution's last normal lifecycle mutation; do not append further lifecycle or Workpad entries after it. If publication succeeds but relation update fails, record the published task and incomplete relation, then use the existing blocker handoff; do not report the follow-up as fully linked.

If the task returns to `In Progress` or `Rework`, follow the existing continuation/reset contract and repeat the required verification and review cycle before returning to `Human Review`.

When a task returns from `Human Review` to `Rework`, follow the Rework reset protocol above. This is the same task's non-terminal rework, not a terminal reopen; do not search for a different Plan. Before the next PR handoff, apply the normal final comparison and move it back to `completed/`.
