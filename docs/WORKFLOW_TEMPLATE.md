# Leesh Loop workflow template

This template defines reusable execution-contract semantics. A target repository owns its concrete `WORKFLOW.md`, which combines Symphony runtime configuration in YAML front matter with this contract as its Markdown worker prompt. Add repository-specific commands, paths, delivery requirements, and review integrations only in that repository workflow.

## Read the accepted task

Read the task and its accepted Plan before making changes. The normalized task description must begin with these exact lines:

```text
Repository Plan Reference: <repository-relative path>
Repository Base Commit: <full Git commit SHA>
```

The Plan declares the path. At publication, Publisher captures the current target-repository base commit and writes both lines. The immutable accepted Plan snapshot is the published task's Plan content, not a Git blob. The tracker adapter transports Description unchanged as `issue.description` without parsing or interpreting a Plan. No new Symphony `Issue` field is required.

This is **initial task binding**, not normal continuation. The authoritative binding signal is the Workpad `binding-established` checkpoint together with the workspace state; Symphony `attempt` is diagnostic context only and must not decide whether binding completed.

At each invocation, classify binding state before editing the repository:

- If the checkpoint exists and its base commit, snapshot identity, materialized path, and workspace state agree, resume the existing workspace, task branch, Workpad, and repository Plan exactly as the previous attempt left them. Do not check out the base commit again or rematerialize the accepted snapshot over durable Plan corrections.
- If the checkpoint is absent and the workspace is safely unbound—either a pristine fresh clone or a partial binding whose only workspace difference is the exact accepted snapshot at the materialization path—perform initial binding idempotently. The clone's current HEAD is not a prerequisite: fetch and check out the published base commit first. Preserve or remove only the verified snapshot path as needed to complete that checkout; any other task change is a conflict.
- After checkout, materialize the accepted snapshot at the path (or verify the already-materialized identical bytes), then verify the complete binding tuple: checked-out base commit, snapshot identity, materialized path and content, and no unrelated workspace changes. Append `binding-established` only after that verification.
- If any checkpoint, workspace, or materialized Plan state conflicts with these conditions, record a recovery blocker and require operator-directed recovery. Do not reset or overwrite the workspace.

Only after initial binding or a verified continuation may the worker open the referenced Plan; it remains the durable baseline for objective, boundaries, decisions, assumptions, constraints, and verification design. It is not an immutable prediction of implementation steps.

The concrete workflow must render `{{ issue.description }}`. If either line is absent or malformed, the path is not repository-relative, the base commit is unavailable, the accepted Plan snapshot cannot be read, materialization does not match that snapshot, or continuation recovery is inconsistent, do not begin work or select another Plan. Record the binding blocker, transition the task to the repository-defined non-dispatchable blocked state through the task surface, confirm authoritative readback, and then stop. Until the Publisher and adapter implement this carrier and snapshot read, a published task is not eligible for autonomous execution under this workflow.

Follow the target repository's guidance and use its intended entry points. Keep repository-wide rules authoritative; this template supplies common execution semantics rather than replacing them.

## Execute from evidence

Use repository and runtime evidence to complete the accepted objective. Execution discovery is expected, including facts and constraints that could not be known with sufficient confidence during planning. You may autonomously change the implementation approach, touch additional necessary components, add required tests or verification, replace a disproved technical assumption, and refine a verification method that cannot prove the result. Work necessary for the accepted objective remains in the current task even if it was not anticipated in the Plan.

Do not ask for approval solely because the actual implementation path differs from the Plan.

## Keep durable knowledge and execution state separate

Update the repository Plan when execution reveals durable planning knowledge: a material correction to an assumption, responsibility boundary, constraint, accepted implementation requirement, verification method, or repository/integration behavior that remains relevant after the task ends. Updating the Plan for such a discovery does not itself require human approval.

Use the mutable Workpad for transient state: progress, attempts, command output, temporary failures, investigation notes, intermediate evidence, blockers, completion checkpoints, and handoff state. Do not turn the Plan into an execution log. A resolved command failure belongs in the Workpad; proof that a material Plan assumption was false belongs in the Plan as durable knowledge.

A compliant Leesh Loop adapter must provide a separate, authenticated agent-side task surface in addition to tracker reads. It must let the worker read the immutable accepted Plan snapshot; read and append Workpad entries; record a decision or binding blocker; and transition task state with authoritative readback. Mutable operations must be idempotent by task and operation key. This surface is not part of Symphony `Issue`, does not require the adapter to parse Plans, and must remain separate from tracker-adapter reads. Until it exists, a task is not eligible for autonomous execution under this workflow.

## Separate follow-up work

When concrete evidence reveals meaningful work not required for the current accepted objective, do not expand the current task. Define separate follow-up work only when its outcome is independently understandable, completion is independently judgeable, and defining it does not require a new material product or contract decision. Do not create speculative follow-ups for optional improvements.

The intended follow-up route is: execution discovery → follow-up Plan artifact (declaring its repository Plan reference) → Publisher validation and normalized Description → normal tracked task. This contract does not prescribe the agent-to-Publisher invocation or relation-writing mechanism.

## Return to human judgment

Stop and surface the decision when new evidence requires changing the accepted objective, a material product decision, a material external contract or compatibility decision, an accepted boundary into a materially different capability, or choosing among materially consequential alternatives not already settled. Do not escalate ordinary implementation discovery, failed approaches, required additional work, or verification refinement. Use the agent-side task surface to record the decision request and blocker even when no Pull Request exists, transition the task to the repository-defined non-dispatchable human-judgment state, and confirm authoritative readback before ending the worker. Add the decision to an existing Pull Request as well when one exists.

## Verify and complete

Verify the representative intended flow through the repository's direct practical interface. Record transient evidence and handoff state in the Workpad; preserve durable corrections in the repository Plan. Keep the bound Plan active through Pull Request review and any rework. Complete only when the accepted objective and verification evidence are satisfied, repository-specific delivery requirements have been met, and any required human decision has been surfaced rather than silently made.

Complete through this idempotent protocol; do not describe cross-system effects as atomic.

1. Append a Workpad `completion-intent` checkpoint with a unique operation key, active and completed paths, and the delivery commit/PR identity. Read it back.
2. Move the Plan to `completed/`, commit and push that repository change, then append a `repository-finalized` checkpoint with its commit identity and read it back.
3. Transition the task terminally through the mutation surface and confirm the tracker readback.

If interrupted before terminal readback, the next worker or operator reads the checkpoint and repository state. With `completion-intent` only, it inspects both paths and the recorded delivery identity: if the Plan is still active, it either finishes the move or clears the intent; if the Plan is already completed, it records the discovered final repository commit as `repository-finalized` and resumes. With `repository-finalized`, it fetches that recorded commit as needed and retries the idempotent terminal transition; if delivery must resume instead, it restores the Plan to the referenced active path, records the recovery, and returns the still-nonterminal task to an eligible state.

Authoritative terminal-state readback ends the task lifecycle. Do not define a terminal-to-active continuation, Plan restoration, or redispatch path for that task. Any work discovered after completion requires a new Plan and a new task.

## Repository extension points

The repository-owned workflow supplies the concrete instructions for its setup and commands, branch and review flow, verification surfaces, delivery mechanism, and any independent review. It must retain Symphony's structure: optional YAML front matter for runtime configuration followed by a Markdown prompt body.

When its tracker is configured, a repository workflow must designate provider-native non-dispatchable states for binding/recovery blockers and human judgment. These states are distinct from autonomous implementation and independent review, which remain runnable while the worker can act on their findings.
