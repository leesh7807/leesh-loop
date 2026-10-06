# Repository workflow

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

Read the repository-owned `AGENTS.md` when present, then follow this file as the complete worker execution contract. Do not require another workflow or template file at runtime.

## Accepted execution input

Treat the Accepted Plan as immutable, correctly published execution input. Do not add publication preflight, re-prove publication or task-to-Plan binding, or repair malformed publication/integration from a normal worker run; those are Publisher, adapter, or integration defects.

Derive the Repository Plan identity from the Accepted Plan H1 `# <date-summary>` and use exactly:

```text
docs/plans/active/<date-summary>.md
```

Do not search for or guess another Plan. If the H1 cannot provide the identity, record the blocker and use the human-required blocker handoff. In a fresh workspace, create the exact Repository Plan from the Accepted Plan if absent; never overwrite an existing Repository Plan with the Accepted Plan.

Use repository evidence and normal engineering judgment to complete the accepted objective. Solve ordinary implementation problems autonomously when needed to deliver it, but do not absorb meaningful work outside it.

The Workpad is mutable live execution context. The Repository Plan is a durable contract artifact, not a running log. Update it only when the delivered objective, intent, boundary, accepted requirement, important assumption, constraint, or verification method materially changes. Do not copy routine history, transient failures, command output, or review transcripts into it.

## Workspace and task surface

The `after_create` hook clones the configured repository before the agent starts. Runtime dependencies are prepared by the Loop outside the task repository. Work only in the Symphony-provided workspace and modify only the target repository unless the Accepted Plan explicitly requires an external artifact.

The worker-facing review interface is `chatgpt-shot`. Use only `chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>`. Do not start, stop, authenticate, repair, or otherwise manage the external Service.

Use the Notion task surface for the Accepted Plan, Workpad, and State changes. Follow the repository-owned workflow or task instructions for Workpad language; if none exists, use the language of the task. Preserve code, commands, identifiers, paths, API names, and quotations verbatim where accuracy requires it. `notion_task_read_workpad` reads only the complete canonical Workpad of this bound task; use it rather than arbitrary Notion access.

If the task surface or its authentication is unavailable, it cannot record a Workpad entry or mutate its State. Do not invent a fallback mutation channel or claim a same-surface handoff occurred; end with the concrete external-access blocker.

## Worker follow-up capabilities

The bound worker session exposes:

* `notion_task_publish_plan`: publish a complete Plan through the Publisher with final State `Backlog`; the Publisher owns database binding, canonical representation, Identifier, Plan relation/content, locking, incomplete-publication handling, and validation, and returns canonical `identifier` and `page_id`.
* `notion_task_add_blocked_by`: add a canonical blocker page to the bound task's `Blocked By` relation while preserving existing blockers.

These are separate operations. Publication does not mutate the current task relation; Blocked By does not publish or edit Plan content. The current task comes from runtime binding, not worker input. Failures do not authorize worker-side fallback or arbitrary Notion management.

## Repository state and delivery

* `Backlog` is non-active, non-terminal, and never dispatchable.
* `Ready`, `In Progress`, `Rework`, and `Merging` are active. Move `Ready` to `In Progress` before implementation. `Rework` is only human-selected review rejection. `Merging` only authorizes merging the Approved delivery from the preceding Human Review, including conflict resolution within that approval.
* `Human Review` is the single non-active, non-terminal human pause state. A human may select `In Progress`, `Rework`, or `Merging`. Comments never dispatch or approve. Workers enter Human Review after validated delivery, for a human-required blocker, or when independent review cannot continue; record `reason: review` or `reason: blocker`. Workers never select `Rework` or `Merging`.
* `Done` and `Cancelled` are terminal. `Done` requires verified merge of the Approved PR onto the configured remote base; implementation, verification, review, or a merge command alone is insufficient.

## Reconstruction and Workpad

Every dispatch—initial, continuation, retry, or return from Human Review—reads current State and Accepted Plan, resolves the deterministic Repository Plan, reads the canonical Workpad, inspects workspace/Git state, and reconciles current truth. State is lifecycle authority; workspace is repository truth; Workpad is live execution context; Repository Plan is durable execution contract. Reconcile material Workpad/workspace differences from the workspace and do not repeat completed work merely because a worker restarted.

If the previous execution yielded to `Blocked By` and the same active task resumes with its preserved workspace, treat it as blocked-work continuation. Fetch the latest configured remote base and rebase the preserved task branch before continuing implementation; resolve conflicts under the same semantic authority boundary as Merging. This resume does not by itself start a new review pass or reinitialize Review Confidence.

Write concise Workpad entries at meaningful milestones: material approach choice/change, substantial implementation, material finding/constraint, representative validation, review result/disposition/fix, Review Confidence update, blocker, remaining work, Human Review preparation/entry, Review Input consumption, Rework reset, or Merging result. Do not narrate commands or add a fixed format beyond required markers.

Use only these lifecycle markers:

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

Prepare each Human Review with the next monotonically increasing cycle, latest comment ID baseline, delivered PR, and delivered HEAD. From a Merging blocker, preserve the cycle's `approved_pr`/`approved_head` as delivered identity; never promote a failed conflict-resolution HEAD. Confirm the Workpad append, transition to `Human Review`, and append `Human Review Entered` when possible. Retry an explicit State-mutation failure with the same prepared cycle. A missing Entered marker may be repaired when State is already Human Review, but it must never override an explicit active State.

At the first `In Progress` or `Rework` after an unconsumed Human Review cycle, reuse an existing `Review Input`; otherwise read provider-ordered comments once, fix `through_comment` to the latest visible comment, and append immutable input for `(comment_baseline, through_comment]`. Use `mode: continue` for `In Progress` and `mode: rework` for `Rework`. If a non-`none` baseline cannot be found despite later comments, surface the ambiguity. Retries reuse the same input. `Merging` consumes no Review Input.

`Human Review → In Progress` preserves workspace, branch, Plan, and valid work after reconciliation.

`Human Review → Rework` rejects that basis. Materialize `mode: rework`, read the latest Repository Plan, fetch the configured remote base, and if this cycle lacks `Rework Reset Complete`, recreate implementation state and a fresh task branch from the exact fetched base, restore the current Plan to `docs/plans/active/<date-summary>.md`, append the reset marker with `origin_base`, then implement. Do not reset twice for the same cycle.

`Human Review → Merging` preserves delivered workspace, branch, and Plan. Reconstruct the preceding Human Review and establish Approved PR/HEAD from its delivered identity before any mutation.

## GitHub target and merging

`SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH` are the only repository/base authority. Never infer either from checkout state, a default branch, or fallback.

Before new implementation, fetch and resolve the configured remote base; if that fails, do not create a task branch. Create the task branch from that exact commit, make only task-related commits, push only that branch, and create the PR with explicit configured base. Never direct-push or direct-merge to the configured base.

Before delivery handoff, inspect final diff/status, run repository-supported checks and `git diff --check`, and compare the actual result with Accepted Plan and Repository Plan. Apply any durable contract correction, move the delivered Plan to `docs/plans/completed/`, and read the PR back from GitHub. A valid delivery PR must target the configured base, source the task branch, and point at exact `delivered_head`; otherwise no valid delivery exists. Preserve that PR identity through review and merging.

On Merging, require the Approved PR and configured base. Before conflict-resolution mutation, require current PR head to equal Approved HEAD when no `merge_target_head` exists, or the recorded target when it does. If conflict-free, record Approved HEAD as merge target. If conflicted, integrate the latest configured base and resolve autonomously only within the Approved delivery's meaning, externally observable behavior, contract, scope, and Accepted Plan approach. If resolution requires a separate material decision, use Human Review blocker handoff.

After conflict resolution, rerun applicable validation, `git diff --check`, final Plan comparison, and PR/merge/readback checks. Conflict resolution alone does not reopen independent review. Record the exact resulting HEAD as `merge_target_head`, re-read the PR immediately before merge, and require the same Approved PR, configured base, and exact target HEAD. Use only the normal GitHub PR merge path.

After merge, fetch the configured base and verify the Approved PR's actual merged/source head equals `merge_target_head` and its merge result is present on fetched remote base. Record verified merge identity.

If the Approved PR is already merged, verify the same identity and remote-base presence. If no target was recorded, the merged/source head must equal Approved HEAD before recording it as target. A differing or ambiguous merged identity is a blocker.

After verified merge, delete the Approved PR's remote source branch when it is safe to do so; branch-cleanup failure alone does not block `Done`. Then transition `Merging → Done`.

A human-required blocker includes missing Approved identity, PR base/head mismatch, unresolved conflict, required decision outside Merging authority, validation failure, GitHub/auth/access failure, ambiguous merge result, merge identity mismatch, absent merge result on fetched base, or configured-base fetch/readback failure. Record concrete condition, repository/validation state, required human action, and remaining work; preserve Approved PR/HEAD as delivered identity; prepare `Human Review` with `reason: blocker`; transition and stop. Never choose an alternate PR, promote an unauthorized later HEAD, perform a repair merge, direct-push the base, or autonomously choose Rework.

Operator bootstrap may create a missing configured base from the repository default branch's current remote HEAD, but the default branch is only a bootstrap seed. Workspace creation, task branches, Rework, PRs, Merging, and Done verification always use the configured base. Continuations preserve workspace. Legacy `origin_main`/`main` markers count only when the configured base is exactly `main`.

## Independent `chatgpt-shot` delivery review

Independent review reduces material uncertainty across four perspectives:

```text
Behavior        — actual behavior and observable-result meaning preserve the contract
Maintainability — the system remains practical to understand, diagnose, change, verify, and recover
Security        — trust and permission boundaries constrain capability and data flow
UI/UX           — the actual interface communicates product meaning/workflow clearly and coherently
```

Use these lenses:

```text
Behavior: Execution semantics / Failure semantics / Outcome semantics
Maintainability: Responsibility structure / Diagnostic structure / Verification structure
Security: Trust / Authorization / Capability / Input and execution boundary / Data protection
UI/UX: Hierarchy / Comprehension / Interaction / Aesthetic quality
```

Each Review Job has one primary perspective. A fact may affect others, but the worker handles that through cross-perspective impact rather than a multi-perspective Job.

### Confidence and initialization

Each perspective has worker-owned `confidence`: how confident the worker is that more independent review from that perspective is unnecessary. It is not correctness probability, implementation quality, coverage, reviewer confidence, PASS count, or finding count.

Use only:

```yaml
threshold: 0.90
initial:
  Settled:  0.90
  Standard: 0.75
  Focus:    0.60
outcome:
  clean:          +0.30
  aesthetic-only: +0.10
  minor-only:     +0.05
  material:       -0.10
  rejected-only:   0
cross-perspective:
  direct material impact: -0.05
other:
  fix: 0
  verification: 0
  HEAD change: 0
range: 0.00..1.00
precision: 2 decimals
```

After implementation and required repository verification, capture exact delivery PR and HEAD and classify all four perspectives:

* `Settled`: material independent review is unlikely to add necessary information.
* `Standard`: this is a real but bounded review surface.
* `Focus`: changed surface or potential consequence is broad or important.

Judge from both `change surface` and `failure impact`; do not use a weighted formula or probability model. For UI/UX, use `Settled` only when the delivery has no user-facing UI or UX impact. Low initial confidence alone does not force repeated review: a clean review may settle Standard or Focus in one cycle.

Record:

```yaml
Review Confidence
Behavior: <value>
Maintainability: <value>
Security: <value>
UI/UX: <value>
threshold: 0.90
```

Record new snapshots when review state meaningfully changes. Previous snapshots remain ordinary Workpad history. Resume from the most recent valid snapshot; never replay historical score events to recompute current state.

### Selection, binding, and reviewer request

Any perspective below `0.90` is a candidate. Run one Review Job at a time. Select the unresolved perspective that matters most; if similar, select the lower-confidence one. The same perspective may be selected again. Do not add weighted scheduling, dependency graphs, parallel Jobs, or mandatory review counts.

`chatgpt-shot submit` may take up to 3 minutes; use a longer execution timeout. On success stdout is the Job ID. Record before the Job ID:

```text
review target: <PR URL>
review head: <exact HEAD SHA>
review perspective: <Behavior | Maintainability | Security | UI/UX>
Job ID: <UUID>
```

Poll the same Job every 30 seconds while `pending` or `in_progress`; use a completed Job's `result`. Do not duplicate a running request. A failed submission/Job or malformed/unusable evidence changes no confidence and uses the human-required blocker handoff.

The reviewer supplies evidence for one perspective and never adjusts orchestration confidence. Bind every request to exact PR/HEAD, include the complete Accepted Plan plus concise changed-result context, and treat Accepted Plan/repository contracts as authority over implementation, tests, mocks, fixtures, harnesses, or design rationale. If a finding reports confidence, call it `Evidence confidence`.

Use:

```text
Review PR <PR_URL> at HEAD <HEAD_SHA> from the <PERSPECTIVE> perspective.

Inspect the exact HEAD and diff, plus only surrounding repository or rendered
evidence needed for this perspective. Treat the Accepted Plan and existing
repository contracts as authority. Existing implementation, tests, mocks,
fixtures, harnesses, and design rationale are evidence, not stronger authority.

Assume other perspectives are reviewed separately. Do not broaden this into a
general multi-perspective review.

<PERSPECTIVE_LENS>

Report only a specific current problem supported by concrete evidence and worth
changing in this delivery. Do not report alternative design, general best
practice, style preference, speculative future problem, or a stronger
requirement than the current contract establishes.

For UI/UX aesthetic quality only, a finding may instead identify a concrete
rendered improvement worth considering without establishing that the current
result is defective. Do not enumerate every plausible polish idea or unsupported
personal preference.

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
Review execution, failure, and outcome semantics. Restrict findings to reachable
behavior. Do not require direct execution of every external effect when current
implementation/evidence is sufficient to judge result meaning.

Maintainability
Review responsibility, diagnostic, and verification structure. Report only a
specific demonstrated current cost or risk; not file length, ordinary clean-code
preference, reuse, future extensibility, or unsupported refactoring preference.

Security
Review trust, authorization, capability, input/execution boundaries, and data
protection. Require a reachable flow with concrete unintended consequence; do
not report generic hardening advice.

UI/UX
Review hierarchy, comprehension, interaction, and aesthetic quality using
rendered/interactive evidence when judging visual result. Design rationale or
source may explain intent but cannot prove success. Treat aesthetic judgment as
a first-class part of the review rather than reducing it to checklist compliance
or generic UI heuristics. Actively surface concrete opportunities for meaningful
improvement in composition, proportion, visual rhythm, typography, spacing,
balance, density, visual weight, or overall coherence when supported by rendered
evidence, even when the current result is not defective. Do not enumerate every
plausible polish idea. `Mere taste` means unsupported personal preference, not
reasoned visual judgment. Express uncertainty through Evidence confidence rather
than suppressing a useful aesthetic finding.
```

### Disposition, resolution, and confidence update

Validate every finding independently. Accept material/minor findings only when a concrete current problem is supported by the Accepted Plan, repository contract, or direct product evidence and is worth changing in this delivery. Do not accept extra hardening, unsupported style preference, possible reuse, future extensibility, or arbitrary "could be better" suggestions merely because they are easy.

For UI/UX aesthetic quality, direct rendered evidence may instead support `accepted aesthetic` when the worker judges that a concrete suggestion is reasonably likely to produce a meaningful net visual improvement. The reviewer surfaces the possibility; the worker owns whether it is worth adopting.

Classify:

```text
accepted material  — valid actionable new information that materially changes
                     uncertainty for the reviewed perspective
accepted minor     — valid actionable current problem worth fixing, but without
                     material uncertainty
accepted aesthetic — UI/UX aesthetic evidence supports a meaningful likely
                     improvement without establishing a required current fix
rejected           — not established as useful evidence worth acting on here
```

`minor` is not a bucket for optional improvements. `accepted aesthetic` is limited to UI/UX aesthetic quality; it records a worthwhile visual-improvement judgment rather than a defect classification and does not by itself require a fix.

One Job produces one strongest outcome:

```text
any accepted material → material -0.10
else any accepted minor → minor-only +0.05
else any accepted aesthetic → aesthetic-only +0.10
else findings all rejected → rejected-only 0
else no findings + usable review → clean +0.30
```

Do not sum findings.

Resolve every accepted material/minor finding before the next selection or completion:

```text
fix applied
AND
relevant verification passed
```

Accepted aesthetic findings do not require resolution. The worker may apply one when the expected improvement justifies the change; otherwise record the disposition and continue.

Use the minimum sufficient verification boundary; broader integration/E2E is required only when the changed behavior or repository contract needs it. Fix and verification do not themselves change confidence. Failed verification means unresolved finding.

Every Job remains bound to the exact PR/HEAD it reviewed. HEAD change itself changes no confidence and does not invalidate all review. After a fix changes HEAD, rerun relevant verification and continue; later Jobs bind to current HEAD.

### Cross-perspective impact

After resolving an accepted material finding, lower each directly affected secondary perspective by `0.05` only when that finding's concrete fact, root cause, disposition, or resolution materially reopens that perspective's core question. Same code/component, general relatedness, or HEAD change is insufficient. Apply at most once per secondary perspective for that material finding lifecycle.

A confidence decrease is not itself evidence for another decrease. However, a later independent review may produce new material evidence whose own disposition/resolution directly opens another perspective; that is a new finding lifecycle and may apply its own cross-impact.

### Completion, blockers, and new review passes

After each meaningful review milestone, record target/HEAD/perspective/Job, result, disposition, accepted fix/verification, cross-impact, and resulting Review Confidence snapshot. Do not copy the full review transcript into the Repository Plan or build a score-event ledger.

Review completes only when:

```text
all perspective confidence >= 0.90
AND
no unresolved material finding remains
AND
all accepted minor findings are resolved
```

Do not require every perspective to run, PASS from every perspective, a fixed reviewer count, identical reviewed HEAD across perspectives, a fixed number of clean reviews, or full rerun after every HEAD change.

A blocker that interrupts an unfinished review pass preserves the most recent valid Review Confidence; resuming the same delivery continues that pass. The same applies to `Blocked By` continuation.

Once review has completed and the delivery entered Human Review with `reason: review`, any later human-directed return to implementation through `In Progress` or `Rework` starts a new review pass. After consuming Review Input, applying the human feedback/intent, and completing required implementation/verification, classify all four initial confidence values again. `In Progress` preserves workspace/approach; `Rework` additionally uses the reset protocol. Neither rule changes the requirement for new initial classification after completed review.

## Review and publish a follow-up Plan

When work reveals a follow-up task, write a complete Candidate Plan before publication. Use `# <date-summary>` as its H1 and treat `Objective`, `Intent`, and `Verification Requirements` together as the top-level planning contract. Keep implementation detail only when it is needed to preserve a decision or make execution unambiguous. Do not use the Plan as an execution log or invent user rationale. Apply KISS, YAGNI, and DRY.

Use this Plan structure:

```markdown
# date-summary

## Objective
<confirmed outcome the work must achieve>

## Intent
<confirmed problem, motivation, and interpretation that materially affects success>

## Verification Requirements
<facts, guarantees, failure behavior, boundaries, and observable outcomes that must be true for success>

## Definitions
<only domain or repository terms that could be misunderstood>

## Decisions
<decisions, assumptions, protected scope, and necessary implementation constraints that carry the top-level contract into execution>

## Verification
<how each material Verification Requirement will be demonstrated through intended execution paths and observable evidence>

## Verification Tools
<tools or mechanisms that can produce or observe the required evidence>
```

Keep material success conditions in `Objective`, `Intent`, or `Verification Requirements`; do not introduce a new success/failure contract only in later sections. Prefer representative end-to-end evidence through the real entry point and authoritative readback. If meaningful end-to-end verification is unavailable, state the exact gap, closest substitute evidence, and remaining material risk.

Review the Candidate Plan through the same `chatgpt-shot` submission/polling/failure mechanics, but Candidate Plan review is not a delivery perspective review and never changes Review Confidence.

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

Incorporate only valid findings. Do not change the Candidate Plan for optional preference or polish. If a valid finding materially changes it, review the revised complete Plan again. Publish only when no valid finding remains.

Record Candidate Plan identity, Job ID/result, and dispositions in ordinary Workpad context. Do not label a Plan review as PR/HEAD-bound when none was submitted.

Publish with `notion_task_publish_plan`, retain canonical `identifier`/`page_id`, then before `notion_task_add_blocked_by` record review disposition, published identity, and that current work is yielding to that blocker. A successful relation update is the execution's last normal lifecycle mutation. If publication succeeds but relation update fails, record the incomplete relation and use blocker handoff.

A blocker resume preserves an unfinished delivery review pass. A human-directed implementation continuation after completed `reason: review` Human Review starts a new pass. `Rework` remains the same task's non-terminal rework; before the next PR handoff apply final Plan comparison and move the Plan back to `completed/`.