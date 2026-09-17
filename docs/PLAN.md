# Plan Instructions

Create and maintain a plan that keeps the work aligned with the objective and makes completion easy to judge.

- Name each plan document using the format `date-summary`.

- Use the confirmed objective, intent, repository conventions, and available evidence to settle decisions that could change the outcome, externally observable behavior, contracts, responsibilities, boundaries, or verification. Include implementation details only when they are necessary to preserve one of those decisions or to make the intended work unambiguous.

- Do not invent reasons, tradeoffs, or justifications for the user.

- Define verification in terms of observable evidence. The plan must make clear how to tell whether the intended result works through the intended path.

- Fix terminology before planning. Use one term for one meaning.

- Update the plan during execution only when new evidence changes an important assumption, decision, boundary, intent, or verification method.

- Do not use the plan as an execution log.

- Keep active plans under `docs/plans/active/`. Before making a Pull Request, move the plan to `docs/plans/completed/`.

When reviewing the plan, check that each planned unit describes a coherent outcome in the problem domain rather than merely an implementation step.

Also check that verification reaches the highest practical level of the real execution path, and that any material gap in end-to-end verification is explicit rather than silently replaced by lower-level tests.

A good planned unit should:

- describe one meaningful responsibility or capability;

- have a result that can be understood and verified on its own;

- avoid combining unrelated responsibilities just to reduce the number of units.

Do not split the plan just to make the work easier for an agent.

If you cannot turn a planned unit into a clear executable issue, check whether you understand its scope and domain boundary well enough.

The final plan should resolve the decisions necessary to preserve the objective, intended behavior, contracts, responsibilities, boundaries, and verification. It should identify the implementation details that are necessary to carry those decisions into execution, without prescribing incidental implementation choices that can safely be left to the executor.

Write in Korean.

KISS, YANGI, DRY is core principle.

## Plan format

```text
# date-summary

## Objective

Describe the intended outcome and what the plan must stay aligned with.

## Definitions

Define terms that are specific to the domain or repository, or that could reasonably be misunderstood.

## Intent

Record the problem, motivation, or desired direction that explains why the objective exists and helps interpret it when implementation choices arise.

Preserve user-provided context when losing it could lead to a materially different implementation.

Do not repeat decisions or implementation requirements here.

## Decisions

Record the decisions, assumptions, and defaults that define the objective or its boundaries.

Include implementation details only where they are necessary to express or preserve a decision, contract, responsibility, boundary, or required verification. Prefer stating what must remain true over prescribing incidental internal structure or execution steps.

Include rationale, constraints, alternatives, or accepted tradeoffs only when they are needed to understand a recorded decision.

Do not repeat background already captured in Intent.

## Verification

Describe the observable evidence that will show whether the objective has been achieved through the intended execution path.

Prefer verification through a representative end-to-end flow that exercises the real entry point, orchestration, integrations, required external effects, and authoritative readback applicable to the objective. Make required external effects explicit in the plan rather than leaving them implicit or substituting lower-level verification.

Treat the inability to perform representative end-to-end verification as a planning problem, not merely a verification limitation, when it leaves the objective or a central guarantee unverified through the real execution path.

If meaningful end-to-end verification is not possible, state exactly what cannot be exercised, why, what closest verification will be performed instead, and what material risk remains unverified.

When missing infrastructure, tooling, or observability prevents representative end-to-end verification, treat enabling that verification as part of the planned work when it is reasonably within the objective's boundary.

## Verification Tools

List the tools or mechanisms that can produce or observe the required evidence, and state briefly what each one can verify.
```