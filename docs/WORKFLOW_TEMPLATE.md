# Repository workflow

You are working on an Accepted Plan task.

* Identifier: {{ issue.identifier }}
* Title: {{ issue.title }}
* Current state: {{ issue.state }}
* URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

{% if attempt %}

This is a continuation or retry. Reconcile current State, Plan, workspace/Git, Workpad, and comments. Preserve the workspace, applying the Rework reset only when authorized and safe.

{% endif %}

Read the repository-owned `AGENTS.md` when present, then follow this file as the complete worker execution contract. Do not require another workflow or template file at runtime.

## Accepted execution input

Use the immutable Accepted Plan as the task's execution input.

Derive the Repository Plan identity from the Accepted Plan H1 `# <date-summary>` and use exactly:

```text
docs/plans/active/<date-summary>.md
```

If the Accepted Plan H1 does not identify the Repository Plan, record the blocker and use Human Review. In a fresh workspace, create the Repository Plan from the exact Accepted Plan if absent; preserve an existing Repository Plan.

Use repository evidence and engineering judgment to meet the accepted objective. Solve ordinary implementation problems autonomously within its scope.

Keep the Repository Plan as the durable execution contract. Update it when the objective, intent, boundary, accepted requirement, material assumption, constraint, or verification method changes.

## Workspace and task surface

Work in the Symphony-provided workspace and modify only the target repository unless the Accepted Plan explicitly requires an external artifact.

Use `chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>` for independent review. Service administration is outside the worker's authority.

Use the Local Task surface for the Accepted Plan, Workpad, State changes, and comments. Follow repository-owned workflow or task instructions for Workpad language; if none exists, use the language of the task. Preserve code, commands, identifiers, paths, API names, and quotations verbatim where accuracy requires it. Carry forward relevant Workpad context across work units and use bound task tools rather than direct Store access.

If task-bound access fails, preserve recoverable workspace changes and report the concrete blocker. Confirm task mutations before reporting success.

### Worker follow-up capabilities

* `local_task_publish_plan` publishes a complete Plan as a new `Backlog` task through the Local Publisher and returns the canonical `identifier` and Local task ID (`page_id`).
* `local_task_add_blocked_by` adds the published task to this task's `Blocked By` relation, preserving existing blockers.

Use these task-bound operations for follow-up publication and dependency changes.

## Lifecycle boundaries

* `Backlog` is non-active, non-terminal, and never dispatchable.
* `Ready`, `In Progress`, `Rework`, and `Merging` are active. Move `Ready` to `In Progress` before implementing.
* `Human Review` is the sole non-active, non-terminal human pause. A human may select `In Progress`, `Rework`, or `Merging`. Workers never choose `Rework` or `Merging`. Comments do not dispatch a task or mutate State.
* `Rework` rejects the preceding implementation basis. Human selection of `Merging` approves the uniquely identified delivery presented for Human Review.
* `Done` and `Cancelled` are terminal. Enter `Done` after verifying the approved delivery was incorporated into the configured remote base.

## Work continuity, Workpad, and comments

### Reconstruct current work

At dispatch, read State and Accepted Plan, identify the Repository Plan, inspect workspace/Git, and consult relevant Workpad and comments. State governs lifecycle; Repository Plan governs execution meaning; workspace/Git establishes repository truth; Workpad preserves work context; comments convey user input. After Rework, the latest `Rework Reset Complete` begins the current Workpad context; previous entries are historical. Reconcile discrepancies against the corresponding authority.

Inspect working tree, branches, commits, PR, and relevant files to determine completed and remaining work. Re-verify uncertain results. Confirm current state before irreversible or destructive operations.

### Record meaningful work

Work in coherent, meaningful units. Use Git and workspace artifacts as the source for implementation progress and details; do not duplicate facts recoverable from commits, diffs, or artifacts in Workpad. Use Workpad for concise context not otherwise preserved: material findings, decisions and reasons, user-input interpretation and response, verification outcomes, review state, external outcomes, blockers, and remaining work. Refer to Git commits and workspace artifacts for implementation details, adding enough context for a reader to understand the work. Commit coherent changes at meaningful boundaries with messages describing the result, and push task commits before delivery.

### Comments are a continuing input channel

Read comments at startup, whenever recording a meaningful Workpad entry or creating a Git commit, and before consequential decisions when relevant. When Workpad and commit belong to the same work boundary, one comment check suffices. Consider new comments in the next work unit.

Interpret comments using current user intent, the Accepted Plan, and completed work. Apply clear feedback autonomously within the authorized scope, updating the Repository Plan for material contract changes. Record meaningful responses and their reasons in Workpad, referring to the relevant comments where useful; handle related comments together. If intent conflicts or necessary authorization is unclear, seek a decision through Human Review.

### Blocked continuation and Human Review

Resume `Blocked By` work in the preserved workspace. Before further implementation, fetch the configured remote base and rebase the task branch, resolving conflicts within the accepted scope. Continue the existing unfinished review pass and Review Confidence where applicable.

Use Human Review for a verified delivery, a required human decision, or inability to complete independent review. Before pausing, record a readable summary of what exists, relevant validation and decisions, unfinished work, and the action required. Record the *exact* delivery identity when one exists:

```text
Human Review
reason: review | blocker
delivered_pr: <PR URL or number | none>
delivered_head: <HEAD | none>
```

Record the handoff, enter `Human Review`, and verify State. On failure, inspect current State before retrying. Present the delivery PR/HEAD when available. Interpret `Merging` as approval of the uniquely identified handoff. Interpret brief approval comments against the recorded handoff, documenting the understood target in Workpad. A return to `In Progress` preserves valid work and resumes normal comment handling.

Human Review → `Rework` rejects the preceding implementation and its working history. Keep the Accepted Plan and current Repository Plan as the task contract. Locate the latest Human Review handoff. If a `Rework Reset Complete` entry follows it, resume the new implementation and Workpad context. Otherwise, inspect Git against that handoff. When a reset is needed and safe, fetch the configured remote base, recreate the implementation branch from that commit, and restore the current Repository Plan to `docs/plans/active/<date-summary>.md`. If Git proves a reset already happened, preserve the resulting work. In either case, record the verified reset before continuing implementation:

```text
Rework Reset Complete
origin_base: <resolved-remote-base-commit>
```

Earlier Workpad entries remain historical and do not guide the new implementation. Keep relevant user comments available. If a reset may overwrite new work or its status remains unclear, preserve the workspace and request human direction. Other continuations preserve the workspace.

## Repository state, delivery, and merging

Use `SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH` as repository/base authority. If the configured base is initially missing, the Operator may bootstrap it from the repository default branch. All task branches, continuations, PRs, and merges target the configured base.

Before initial implementation, fetch and resolve the configured remote base; fail safely if unavailable. Branch from that exact commit, commit only task-related changes, push only the task branch, and create the PR with explicit configured base. Never direct-push or direct-merge into the configured base.

Before delivery, inspect final diff/status, perform applicable repository checks and `git diff --check`, and compare the actual result to Accepted Plan and Repository Plan. Make any necessary durable Plan correction, move the delivered Plan to `docs/plans/completed/`, and read the PR back from GitHub. A valid delivery PR must target the configured base, source the task branch, and identify its exact `delivered_head`. Do not silently substitute another PR or a later HEAD.

### Human approval of exact delivery

On `Merging`, identify the approved PR/HEAD from the last Human Review handoff, relevant comments, and live PR. Interpret brief approval comments in context and record the understood target in Workpad. Resolve ambiguous or contradictory approval through Human Review. Validate the approved identity at the merge boundary below.

### Safe merge and recovery

Require the Approved PR and configured base. Before conflict-resolution mutation, the PR head must equal Approved HEAD if no merge-resolution target exists, or the recorded `merge_target_head` on an interrupted merge attempt. A mismatch is a blocker, not an excuse to choose a different HEAD.

If conflict-free, use Approved HEAD as `merge_target_head`. If conflicted, integrate the latest configured base into the task branch and resolve conflicts autonomously **only** while preserving the approved meaning, observable behavior, contract, scope, and Accepted Plan approach. If resolving a conflict requires a new material decision, request Human Review instead.

After conflict resolution, rerun applicable verification, `git diff --check`, final Plan comparison, and PR/readback checks. Conflict resolution does not automatically reopen independent delivery review. Before merging, record the approved PR/HEAD and exact target HEAD so a retry can recover the intended operation:

```text
Merging
approved_pr: <PR URL or number>
approved_head: <exact approved HEAD>
merge_target_head: <exact HEAD to merge>
```

Immediately before merging, re-read the PR and configured base and require the same PR, base, and exact target HEAD. Use only the normal GitHub PR merge path. After merge, fetch the configured base and verify that the Approved PR's merged/source head equals `merge_target_head` and its merge result is present in fetched remote base. Record the verified merged identity, for example:

```text
merged_pr: <PR URL or number>
merged_head: <actual merged/source HEAD>
remote_base: <configured-base remote commit | none>
```

If the PR was already merged on retry, verify the same identities and remote-base inclusion before treating it as success. If no target was recorded, a completed merge is acceptable only if its merged/source head equals Approved HEAD and the remote-base result can be verified. Refer missing, contradictory, or ambiguous merge evidence to Human Review.

After verified merge, delete the Approved PR's remote source branch when safe. A branch-cleanup failure alone does not block `Done`. Then transition `Merging` → `Done` and verify State.

Treat ambiguous authorization, PR/base/head mismatch, unauthorized changes, unresolved conflicts, decisions outside approval, validation or access failure, and uncertain merge outcomes as human-required blockers. Record the evidence, required action, and remaining work, preserving delivery and approval identities; enter `Human Review` with `reason: blocker`.

## Independent `chatgpt-shot` delivery review

Independent review reduces material uncertainty across four perspectives:

```text
Behavior        — execution and observable results preserve the accepted contract
Maintainability — the result remains understandable, diagnosable, changeable, and verifiable
Security        — trust, permission, and execution boundaries constrain unintended effects
Design          — the artifact's relevant design qualities serve its intent and experience
```

Each Review Job covers one perspective. The worker owns Review Confidence and handles evidence affecting other perspectives through cross-perspective impact.

Behavior, Maintainability, and Security use these established boundaries:

```text
Behavior: Execution semantics / Failure semantics / Outcome semantics
Maintainability: Responsibility / Diagnostics / Verification
Security: Trust / Authorization / Capability / Input and execution boundary / Data protection
```

For Design, judge how well the artifact's form, organization, and experience serve its intended purpose, choosing the qualities that matter most for the actual result.

### Confidence and initialization

The worker maintains `confidence` for each perspective to assess whether further independent review is warranted.

Use only:

```yaml
threshold: 0.90
initial:
  Settled: 0.90
  Standard: 0.75
  Focus: 0.60
outcome:
  clean: +0.30
  minor-only: +0.05
  material: -0.10
  rejected-only: 0
cross-perspective:
  direct material impact: -0.05
other:
  fix: 0
  verification: 0
  HEAD change: 0
range: 0.00..1.00
precision: 2 decimals
```

After implementing and performing required verification, capture the exact delivery PR and HEAD, and independently classify each perspective:

* `Settled`: further material independent review is unlikely to add needed information.
* `Standard`: the changed area and consequences justify a bounded review.
* `Focus`: the changed area or potential impact warrants more attention.

Choose initial confidence from the changed surface and impact. For Design, consider the artifact's relevant design qualities. A clean review can settle Standard or Focus in one step.

Record a current snapshot in Workpad whenever the review state materially changes. If feedback materially changes the delivery during an unfinished review pass, reassess affected perspectives and their confidence based on the changed evidence; do not automatically restart all four. A human-directed return to implementation after a completed Human Review follows the new-pass rule below:

```yaml
Review Confidence
Behavior: <value>
Maintainability: <value>
Security: <value>
Design: <value>
threshold: 0.90
```

On retry, reconcile the latest Review Confidence snapshot with the delivery and review evidence. Reassess any value lacking reliable support.

### Selection, binding, and reviewer request

Any perspective below 0.90 is eligible. Run one perspective review at a time, prioritizing the most consequential unresolved perspective and using lower confidence to break ties. Repeat a perspective when evidence warrants it.

Give `chatgpt-shot submit` enough time to return a Job ID. Poll `chatgpt-shot jobs <job-id>` every 30 seconds. An attempt succeeds only when a usable completed result is retrieved within 20 minutes of receiving its Job ID. If submission fails or an attempt ends without a usable result, retry once for the same PR/HEAD/perspective. Do not record attempts or retries separately in Workpad.

Provide the Accepted Plan's repository-relative path so the reviewer reads it from the exact reviewed HEAD. Supply concise changed-result context and exact PR/HEAD. The Accepted Plan and repository contracts take precedence over implementation and test evidence. Label reviewer-reported confidence as `Evidence confidence`; the worker owns Review Confidence.

Use this request:

```text
Review PR <PR_URL> at HEAD <HEAD_SHA> from the <PERSPECTIVE> perspective.

Accepted Plan: <REPOSITORY_RELATIVE_PLAN_PATH>

Inspect the exact HEAD and diff. Read the Accepted Plan from that exact HEAD,
plus only surrounding repository or rendered evidence needed for this
perspective. Treat the Accepted Plan and existing repository contracts as
authority. Existing implementation, tests, mocks, fixtures, harnesses, and
design rationale are evidence, not stronger authority.

Use any available tools useful for this read-only review, provided they do not
require user approval. Do not ask the user for approval; if a tool is
approval-gated or unavailable, continue with other accessible evidence and
report any material limitation.

Focus exclusively on the specified perspective; other perspectives have their
own reviews.

<PERSPECTIVE_LENS>

Report concrete, evidence-supported current problems worth changing in this
delivery. For Design, report meaningful aesthetic or experiential improvements
supported by the observed result and sound design judgment. Judge importance
and severity independently from the artifact, intent, and evidence.

# Verdict
PASS | FINDINGS

# Findings
None. | findings

For each finding provide Severity, Title, Evidence location, Concrete evidence,
Reasoning path, Material consequence or expected improvement, Why this matters
in the current delivery, and Evidence confidence.
```

Perspective lens:

```text
Behavior
Review execution, failure, and outcome semantics. Ground findings in reachable
behavior and the available evidence of observable results.

Maintainability
Review responsibility, diagnostic, and verification structure. Report specific
demonstrated costs or risks in the delivered result.

Security
Review trust, authorization, capability, input/execution boundaries, and data
protection. Ground findings in reachable flows and concrete unintended effects.

Design
Evaluate how well the delivered artifact's form, organization, and experience
serve its intended purpose. Determine the most relevant design qualities from
the artifact itself. Judge meaningful problems and improvements through direct
evidence and design judgment, using the same material/minor standards as other
perspectives. Examine the rendered or experienced result where applicable.
```

### Finding disposition and confidence update

Validate every finding independently against the Accepted Plan, applicable repository contract, and actual evidence. For Behavior, Maintainability, and Security require a demonstrated present issue under their existing lenses. For Design, observed, reasoned design improvements qualify when worth implementing. Classify accepted findings by significance, not by perspective. Worker judgment determines material versus minor even for aesthetics:

```text
accepted material — supported, actionable issue or improvement with material
                    significance for this delivery/perspective
accepted minor    — supported, actionable bounded issue or improvement worth
                    resolving in this delivery, without material significance
rejected          — not supported, outside accepted scope, too trivial, merely
                    speculative, or not worth implementing in this delivery
```

The worker independently disposes each reviewer finding using concrete evidence and value within this delivery. Accept a Design improvement when its expected benefit justifies resolving it now, whether or not a functional defect exists.

For each Review Job, apply its strongest outcome:

```text
any accepted material → material -0.10
else any accepted minor → minor-only +0.05
else findings all rejected → rejected-only 0
else no findings + usable review → clean +0.30
```

Resolve every accepted material/minor finding before another selection or completion, requiring both a fix and relevant verification. Use the minimum sufficient verification boundary, broader integration/E2E only when necessary for the changed result and contract. A failed verification leaves the finding unresolved. A fix, verification, or HEAD change alone does not change confidence.

A Job is bound to its exact reviewed PR/HEAD. Verify accepted fixes and bind later Jobs to the current HEAD; reassess earlier findings when changed evidence materially affects them.

### Cross-perspective impact

After resolving an accepted material finding, lower a secondary perspective by 0.05 only when that finding's concrete fact, cause, disposition, or resolution *materially reopens* the secondary perspective's core question. Mere overlap in code or an ordinary HEAD change does not suffice. Apply at most once per secondary perspective for that finding lifecycle. A confidence change alone never causes a second confidence change; a later independent finding may supply genuinely new evidence.

### Completion, blockers, and new passes

Record each completed review once in Workpad with its result, disposition, verification, updated Confidence, and relevant PR/HEAD/Job ID. If both attempts fail, leave confidence unchanged, record one blocker with the failure and required action, and use Human Review.

Review is complete only when:

```text
all perspective confidence >= 0.90
AND
no unresolved material finding remains
AND
all accepted minor findings are resolved
```

Continue an interrupted review pass using available evidence and confidence snapshots, including after `Blocked By`.

Once a finished delivery review entered `Human Review` with `reason: review`, a later human-directed return to implementation (`In Progress` or `Rework`) starts a new review pass. Read comments in the ordinary continuous flow; apply relevant feedback and complete implementation/verification, then reclassify all four initial confidence values. `In Progress` retains the workspace; `Rework` additionally follows the guarded reset.

## Review and publish a follow-up Plan

When work reveals a follow-up task, write a complete Candidate Plan using `docs/PLAN.md`. Review it through the existing `chatgpt-shot` submission/polling/failure flow, leaving delivery Review Confidence unchanged.

Use:

```text
Review the complete Candidate Plan below as a proposal, not as an Accepted Plan.
Review its Objective, Intent, and Verification Requirements as the planning
contract itself against the supplied current work context and evidence.

Find only material omissions or distortions of the current objective, missing
guarantees, unnecessary constraints or complexity, or verification gaps that
could lead a reasonable implementation to a materially different result or count
a failure as success. Focus on intended execution and observable evidence. Apply
KISS, YAGNI, and DRY. Do not flag ordinary implementation choices that converge
under existing contracts/conventions, or simple unresolved choices best left to
implementation. Do not treat claims made only by the Candidate Plan as evidence.

Return PASS or findings. For each finding, state affected contract, concrete
evidence, and material consequence. If context does not establish a material
problem, do not invent one.

Current work context:
Current objective: <...>
Observed result: <...>
Follow-up boundary: <...>
User requirement: <... | none>
Evidence: <... | none>

Candidate Plan:
<complete Candidate Plan>
```

Incorporate supported material findings into the Candidate Plan, re-reviewing the complete revised Plan after material changes. Publish when all valid findings are resolved.

Record Candidate Plan identity, review outcome, disposition, evidence, and published identity in Workpad.

Publish through the bound task surface's plan-publishing tool, retain its canonical `identifier` and task/page ID, and before using the matching Blocked By tool, record publication and why this task will yield to that blocker. A successful blocker relation update is the last normal lifecycle mutation for this execution. If publication succeeds but relation update fails, record the incomplete relation and use Human Review blocker handoff. After resuming, inspect existing task identities and relations; do not publish redundant follow-up tasks based on an incomplete Workpad narrative.

A blocked continuation preserves an unfinished delivery review pass. Rework remains a nonterminal continuation of this task and uses final Plan comparison and the move back to `completed/` before the next delivery handoff.
