# Plan Instructions

Create and maintain a Plan that keeps work aligned with its accepted objective and makes completion easy to judge. A Plan is a durable repository artifact: it records the accepted objective, boundaries, important decisions, assumptions, constraints, and verification design. It is not a prediction of every implementation step. Execution discovery is expected rather than a planning failure.

- Name each Plan document using the format `date-summary`.
- Use confirmed product intent, repository conventions, and available evidence to settle decisions that could materially change the objective or its boundaries before execution begins.
- Record only the decisions, assumptions, and defaults needed to keep implementation aligned with the objective. When the user explains an important choice, preserve the relevant rationale, constraints, alternatives, or accepted tradeoffs; do not invent them.
- Define verification in terms of observable evidence through the intended path. Fix terminology before planning: use one term for one meaning.
- Give every Plan that will be dispatched an explicit repository Plan reference: the exact repository-relative active Plan path at publication.

## Execution relationship

The accepted Plan is the durable planning baseline, not an immutable implementation script. The reusable workflow defines how a worker adapts execution from this baseline.

Update the repository Plan when execution reveals **durable planning knowledge**: information that should remain part of the correct understanding of the completed work. This includes material corrections to assumptions, responsibility boundaries, constraints, accepted implementation requirements, verification methods, and repository or integration behavior relevant to maintenance or review. A Plan update itself does not require approval.

Do not update a Plan merely to mirror history. Workpad handling, follow-up work, human-judgment boundaries, task binding, and completion are execution semantics owned by [`WORKFLOW_TEMPLATE.md`](WORKFLOW_TEMPLATE.md).

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

Record the exact repository-relative active path at publication, for example `docs/plans/active/date-summary.md`. The reusable workflow binds this materialization path separately from the repository base commit and carries the immutable accepted Plan snapshot independently of Git.

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
