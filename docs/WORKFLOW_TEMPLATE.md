# Leesh Loop reusable workflow template

This template supplies the common Plan-based worker policy and GitHub delivery defaults shared by Leesh Loop repositories. A repository-owned `WORKFLOW.md` can add Symphony configuration, workspace setup, tracker states, language policy, and repository-specific build/test guidance. This file does not replace Symphony orchestration: scheduling, dispatch, retries, continuation, reconciliation, and workspace/session lifecycle remain Symphony core responsibilities.

The concrete upstream `elixir/WORKFLOW.md` in OpenAI Symphony is a useful worker-policy reference only. It is not inherited by Leesh Loop workers.

You are working on an Accepted Plan task.

* Identifier: {{ issue.identifier }}
* Title: {{ issue.title }}
* Current state: {{ issue.state }}
* URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

## Start from the accepted execution input

Treat the task's Accepted Plan as an immutable, correctly published execution input. Do not add a publication preflight, re-prove publication or task-to-Plan binding, or attempt to repair malformed publication/integration from a normal worker run. Those are Publisher, adapter, or integration defects.

Read the Accepted Plan and derive its required H1 identity. A valid identity is its `# <date-summary>` heading. The corresponding active Repository Plan is exactly:

```text
docs/plans/active/<date-summary>.md
```

Do not search for, select, or guess another Plan. If the H1 cannot provide that identity, treat it as an ordinary execution blocker: record the facts in the Workpad and follow the concrete repository workflow's blocker handoff. When the determined Repository Plan is absent in a fresh workspace, create that exact path from the immutable Accepted Plan as its initial durable artifact. Do not overwrite an existing Repository Plan with the Accepted Plan; it may contain a prior material correction.

## Execute the accepted objective

Use repository evidence and normal engineering judgment to complete the Accepted Plan. Solve ordinary implementation problems autonomously; the actual implementation path may differ from an anticipated one when that is necessary to deliver the accepted objective. Do not absorb meaningful work outside that objective.

Use the repository's intended entry points and its authoritative repository guidance. Every dispatch must reconstruct practical current state from current tracker State, the Accepted/Repository Plan, canonical Workpad, and actual workspace. State is lifecycle authority, the workspace is concrete repository truth, the Workpad is live execution context, and the Repository Plan is the durable contract. On a retry or continuation, preserve completed work and reconcile from the workspace rather than restarting it. The configured repository and base branch in the concrete workflow or runtime configuration are authoritative; do not infer them from the checkout, a default branch, or a fallback. Start new implementation work from a fresh task branch based on the fetched current configured base, and do not proceed from local or stale state if it cannot be established.

## Keep the two task records distinct

The Workpad is the mutable live execution surface. Record current approach, meaningful completed progress, material investigation findings, validation results, review state, blockers/uncertainty, and remaining work promptly at meaningful milestones. Do not make it command-by-command logging. A task-bound Workpad read primitive must provide the complete canonical Workpad in provider order and may not allow arbitrary provider-page access; worker-visible read failures must be structured.

The Repository Plan is a durable project artifact, not a running log. Before repository handoff, compare it with the actual result. Update it only when the result materially changes the objective, intent, boundary, accepted requirement, important assumption, constraint, or verification method. Do not copy routine history, transient failures, command output, or review transcripts into it. A repository may require a compact, finding-by-finding independent-review ledger in that task's own Repository Plan; it must contain only the reviewed identity, verdict, disposition, applied commit, and verification summary, never the transcript or general execution history.

## Human Review and rework

`Human Review` is the one non-active, non-terminal state for any human pause: review, blocker, external dependency, or independent-review intervention. Before pausing, record current state and required human action in Workpad, prepare a monotonic Human Review cycle, transition State, and record successful entry when possible. Workpad markers improve ordinary retry/restart behavior but are not a transactional State-mutation history: an absent entered marker must never override an explicit active State.

Each prepared cycle has a fixed comment baseline. At the first `In Progress` or `Rework` observation after that cycle, materialize one immutable `Review Input` entry using comments in the bounded interval through the latest comment visible at first active observation. Comments never dispatch a worker or change State. `In Progress` resumes the preserved workspace and approach. `Rework` rejects that implementation basis: start a fresh task branch from the fetched current configured base and restore the latest Repository Plan before implementation. `Merging` is the human-authorized phase for the Approved delivery from the preceding Human Review; preserve its identity, workspace, and Repository Plan. Keep that approval identity distinct from the merge target, the exact HEAD selected for merge: conflict resolution may change the merge target but does not create a new Approved delivery. Resolve conflicts autonomously when they remain within the approved meaning, scope, and Accepted Plan approach; pause for a separate human decision if resolution changes them. A human-required blocker must move to `Human Review`, not remain intentionally active.

## Tracker state and task records

At each dispatch, read the current task State, Accepted Plan, the matching Repository Plan, Workpad, and actual workspace/Git state. State controls whether work may proceed; the workspace is repository truth; the Workpad is live execution context. Follow the repository-owned workflow or task instructions for Workpad language. Record material progress and evidence promptly, and do not use it as a command log. Update the Repository Plan only for material contract changes, not routine history.

`Ready` work moves to `In Progress` before implementation. `Human Review` is the human pause for a validated delivery or a concrete blocker. Comments alone never dispatch work, select `Rework` or `Merging`, or approve a merge. Workers never transition a task into `Rework` or `Merging`; those are human-selected states. A worker may move a task to `Done` only after the human-authorized PR merge has been verified on the configured remote base.

## GitHub target and delivery

The Project's `github_repository_url` and `github_base_branch`, exposed as `SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH`, are the only target and base authority. Do not infer them from the checkout, a default branch, or a fallback. Before new implementation, fetch `origin` for the configured base and create the task branch from that fetched remote commit. If the configured base cannot be fetched or resolved, stop before creating a task branch.

Inspect the target repository's own guidance and manifests to identify applicable build and verification commands. Do not invent repository-specific setup, build, or test commands. Before opening or updating a delivery PR, inspect the final diff and status, run the checks supported by the repository's own guidance, run `git diff --check`, and compare the result with the Accepted Plan and Repository Plan. Push only the task branch. Create the PR with an explicit configured base, preserve the same PR identity through review and human handoff, and never push or merge directly into the configured base.

Before human handoff, read the PR back from GitHub and confirm it exists, targets the configured base, sources the task branch, and points at the exact delivered HEAD. Record the PR identity and HEAD in the Workpad. After the human selects `Merging`, verify that exact Approved PR and HEAD before merging. If a conflict can be resolved within the Approved delivery and Accepted Plan, integrate the latest configured base into the PR branch and rerun applicable checks; a different approval decision requires `Human Review`. Record the exact merge target before merging, use the normal PR merge path, fetch the configured base afterward, and verify that the approved merge result is present there before moving to `Done`. A merge failure or ambiguous result is a blocker, never a successful completion.

## Verify and hand off

Verify the representative intended flow through the repository's practical interfaces. Follow additional repository-specific guidance for setup, build/test commands, language policy, review, and handoff. A successful worker run, implementation completion, ordinary verification, or merge command is not by itself a terminal task transition. The task may enter its successful terminal state only after the Approved delivery has actually been merged and the resulting remote configured base has been verified.

## Independent delivery review

Use only the worker-facing `chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>` commands. Do not start, stop, authenticate, repair, or otherwise manage the external Service.

After implementation and repository verification, capture the exact delivery PR URL and `git rev-parse HEAD`. Run a code review and then a structural review for that same PR and HEAD. A raw `PASS` is not required when every reported finding has been checked against the Accepted Plan and existing repository contracts, and no valid finding remains. If an accepted fix changes HEAD, rerun affected verification and restart both reviews from code review on the new HEAD.

Before recording a Review Job result, record its exact binding in the Workpad immediately before its Job ID:

```text
review target: <PR URL>
review head: <exact HEAD SHA>
Job ID: <UUID>
```

Poll the same Job every 30 seconds while its state is `pending` or `in_progress`. Use a completed Job's `result` as the review result. A failed submission or Job has not passed the gate; record the concrete failure and use the repository workflow's human-required blocker handoff. Do not submit a duplicate Job for a request that is still running.

For code review, ask the reviewer to inspect the specified HEAD and diff before confirming findings. Accept only a concrete, reachable violation of the Accepted Plan or an existing repository contract. Each finding must identify severity, location, code evidence, reproduction path, impact, why it violates the contract, and confidence. Improvements, speculation, style, intended behavior, and stronger requirements than the current contract are not defects. Validate findings independently; fix only material actionable findings, and record evidence-based rejection reasons for invalid ones.

Use this request shape for code review:

```text
Review PR <PR_URL> at HEAD <HEAD_SHA> against the Accepted Plan below.
Inspect the exact HEAD and diff before confirming a finding. Report only a concrete,
reachable violation of an Accepted Plan requirement or existing repository contract.
Do not report style, speculation, intended behavior, or a stronger guarantee than
the current contract requires. For each finding provide severity, title, file:line,
code evidence, reproduction path, impact, why it violates the contract, and confidence.
Return one Markdown document:

# Verdict
PASS | FINDINGS

# Findings
None. | findings with the fields above
```

Include the Accepted Plan and concise context for the changed result in the request. Add extra criteria only when the Accepted Plan explicitly contains them.

For structural review, use the same PR and exact HEAD after the code review is settled. Restrict it to the PR diff and surrounding code needed to understand responsibilities, ownership, change locality, state/data ownership, abstraction boundaries, and verification costs. Report a finding only when the current structure creates a specific demonstrated cost or risk. File length, general clean-code preferences, possible reuse, future extensibility, and ungrounded refactoring suggestions are not findings. Validate each finding independently and resolve or reject it with a reason before human handoff.

Use this request shape for structural review:

```text
Review the structure of PR <PR_URL> at HEAD <HEAD_SHA>. Assume behavior correctness
was reviewed separately. Limit scope to the PR diff and surrounding code needed to
understand its responsibilities, ownership, dependencies, state/data ownership,
abstractions, and verification boundary. Report only a specific cost or risk caused
by the current structure, with severity, title, file:line, code evidence, a concrete
reasoning path, structural cost, why this is a current finding, and confidence.
Do not report file length, ordinary clean-code preferences, reuse, future expansion,
or refactoring ideas without demonstrated cost.

# Verdict
PASS | FINDINGS

# Findings
None. | findings with the fields above
```

Record each review target, Job ID, completed result, findings, dispositions, fixes, post-fix verification, and any re-review in the Workpad, following the repository-owned language policy. Do not copy the full review transcript into the Repository Plan. Do not prepare human review until both review types are complete for the same exact PR and HEAD and every finding is dispositioned.

Do not define a Leesh Loop-specific human-decision taxonomy, publication-recovery lifecycle, binding checkpoint lifecycle, completion checkpoint lifecycle, or terminal reopen protocol here.
