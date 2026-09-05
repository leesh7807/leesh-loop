# Plan Instructions

Create and maintain a plan that keeps the work aligned with the objective and makes completion easy to judge.

- Name each plan document using the format `date-summary`.

- Use the confirmed objective, repository conventions, and available evidence to settle decisions that could change the outcome.

- Record only the decisions, assumptions, and defaults needed to keep implementation aligned with the objective.

- When the user explains an important choice, record that explanation if a later reviewer will need it. This can include stated constraints, alternatives, rationale, and accepted tradeoffs.

- Do not invent reasons, tradeoffs, or justifications for the user. If the user did not explain a choice, record the choice without adding a reason.

- Define verification in terms of observable evidence. The plan must make clear how to tell whether the intended result works through the intended path.

- Fix terminology before planning. Use one term for one meaning.

- Update the plan during execution only when new evidence changes an important assumption, decision, boundary, or verification method.

- Do not use the plan as an execution log.

- Keep active plans under `docs/plans/active/`. Before making a Pull Request, move the plan to `docs/plans/completed/`.

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