# Plan Instructions

Create and maintain a Plan that keeps work aligned with its accepted objective and makes completion easy to judge. A Plan is a durable repository artifact: it records the accepted objective, boundaries, important decisions, assumptions, constraints, and verification design. It is not a prediction of every implementation step. Execution discovery is expected rather than a planning failure.

- Name each Plan document using the format `date-summary`.
- Use confirmed product intent, repository conventions, and available evidence to settle decisions that could materially change the objective or its boundaries before execution begins.
- Record only the decisions, assumptions, and defaults needed to keep implementation aligned with the objective. When the user explains an important choice, preserve the relevant rationale, constraints, alternatives, or accepted tradeoffs; do not invent them.
- Define verification in terms of observable evidence through the intended path. Fix terminology before planning: use one term for one meaning.
- Give every Plan that will be dispatched an explicit repository Plan reference: the exact repository-relative active Plan path at publication. Publisher must validate the declaration and carry it in the normalized task description; the adapter must pass that description unchanged to the worker. A worker must not locate its Plan by scanning, title matching, or inferring from `docs/plans/active/`.
- Keep a non-terminal task's Plan under `docs/plans/active/`, including while its Pull Request is under review and during any resulting rework. Move it to `docs/plans/completed/` only as part of terminal completion, after all required review and delivery work is done.

## Execution relationship

The accepted Plan is the planning baseline, not an immutable implementation script. An executor may autonomously adapt the technical approach, touch additional files or components, add necessary tests or verification, replace disproved technical assumptions, and refine an invalid or insufficient verification method when evidence requires it. Additional work required to achieve the accepted objective remains in the current task even when the Plan did not enumerate it. Execution-path divergence alone does not require human approval.

Update the repository Plan when execution reveals **durable planning knowledge**: information that should remain part of the correct understanding of the completed work. This includes material corrections to assumptions, responsibility boundaries, constraints, accepted implementation requirements, verification methods, and repository or integration behavior relevant to maintenance or review. A Plan update itself does not require approval.

Do not update a Plan merely to mirror history. Put transient execution state in the task's mutable **Workpad**: progress, attempts, command output, temporary failures, investigation notes, intermediate evidence, blockers, and handoff state. For example, a resolved command failure belongs only in the Workpad; evidence that an important Plan assumption was false must also correct the repository Plan.

Return to human judgment when evidence would require changing the accepted objective, a material product decision, a material external contract or compatibility decision, an accepted boundary into a materially different capability, or an unsettled alternative whose tradeoff materially affects product or contract behavior. Do not escalate ordinary implementation discovery, failed approaches, required additional implementation work, or verification refinement.

## Follow-up work

Do not absorb meaningful work discovered during execution when it is not required to complete the current accepted objective. Create a separate follow-up only when concrete evidence supports the need, its outcome and completion are independently understandable and judgeable, and defining it does not invent a material product or contract decision. Do not publish speculative improvements merely because they could be made. If a follow-up depends on a material undecided choice, return that choice to human judgment instead.

The intended Leesh Loop path for a valid follow-up is a new follow-up Plan artifact, then the normal Publisher path to a Notion task. The current Plan does not implement or assume an agent-to-Publisher invocation, tracker relation writing, or adapter tooling.

## Dispatch binding

Publication and execution use separate responsibilities for one binding. The repository Plan declares its exact active repository-relative path at publication in its `Repository Plan Reference` section. Publisher validates that declaration and makes the normalized `Description` begin with the exact line `Repository Plan Reference: <repository-relative path>`. The tracker adapter copies that Description unchanged into Symphony's existing `Issue.description`; the workflow renders `{{ issue.description }}`. The adapter does not parse or interpret the Plan, and no new Symphony `Issue` field is required. The reference identifies the one writable repository Plan for durable corrections. The published Plan snapshot remains the accepted starting-state record and is not synchronized after execution.

Until the Publisher and adapter expose this carrier, a published task may exist but is not eligible for autonomous execution under this workflow. A worker that receives a missing, malformed, non-repository-relative, or unresolved reference must not select another Plan; it records the blocker and returns it for resolution.

The referenced active path remains live through implementation, Pull Request review, and rework. At terminal completion, after required review and delivery are complete, move the Plan to `completed/` and transition the task to its terminal state as the same completion operation. If a terminal task is reopened, restore its Plan to the original referenced active path before it becomes dispatchable again. The old reference is then historical provenance only while terminal; it must resolve again before another worker can start.

When reviewing the plan, check that each planned unit describes a coherent outcome in the problem domain rather than merely an implementation step.

A good planned unit should:

- describe one meaningful responsibility or capability;

- have a result that can be understood and verified on its own;

- avoid combining unrelated responsibilities just to reduce the number of units.

Do not split the plan just to make the work easier for an agent.

If you cannot turn a planned unit into a clear executable issue, check whether you understand its scope and domain boundary well enough.

The final plan should be complete enough for implementation to begin without unresolved planning decisions that could change the objective or its boundaries.

## Plan format

```text
# date-summary

## Repository Plan Reference

Record the exact repository-relative active path at publication, for example `docs/plans/active/date-summary.md`. This is the task's deterministic binding to its writable repository Plan. Keep it active until terminal completion; it becomes historical provenance only after the Plan moves to `completed/` as part of terminal completion.

## Objective

Describe the intended outcome and what the plan must stay aligned with.

## Definitions

Define terms that are specific to the domain or repository, or that could reasonably be misunderstood.

## Decisions

Record the decisions, assumptions, and defaults that define the objective or its boundaries.

When the user has explained an important choice, include the relevant rationale, constraints, alternatives, or accepted tradeoffs.

Do not invent explanations the user did not provide.

## Verification

Describe the observable evidence that will show whether the objective has been achieved through the intended execution path.

## Verification Tools

List the tools or mechanisms that can produce or observe the required evidence, and state briefly what each one can verify.
```
