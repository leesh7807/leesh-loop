# Plan Instructions

Create and maintain a plan that keeps the work aligned with the objective and makes completion easy to judge.

- Use `date-summary` as the plan document's H1 heading.

- Treat Objective, Intent, and Verification Requirements as the complete top-level contract. A human must be able to review the intended outcome and success conditions from these sections alone.

- Do not change the confirmed top-level contract without an explicit user request. Later sections must not introduce or alter material acceptance conditions.

- Use the confirmed contract, repository conventions, and available evidence to resolve decisions that materially affect behavior, contracts, responsibilities, boundaries, or verification.

- Leave ordinary engineering decisions to execution unless different choices could materially affect those properties. Include implementation details only when needed to preserve a decision or remove material ambiguity.

- Do not invent reasons, tradeoffs, or justifications for the user.

- Fix terminology before planning. Use one term for one meaning.

- Define verification through sufficient observable evidence, using representative practical paths when integration or external outcomes matter.

- Keep the plan focused on intended work, not execution history.

- Follow KISS, YAGNI, and DRY.

A plan is complete when the top-level contract is reviewable and the decisions necessary for consistent execution and verification have been resolved.

## Planned Units

Organize work into coherent domain responsibilities or capabilities, not implementation steps or agent convenience.

Each unit should:

- Have one meaningful responsibility or capability.

- Have a clear outcome that can be understood and verified.

- Avoid combining unrelated responsibilities merely to reduce the number of units.

Do not split work solely to make it easier for an agent.

## Plan Format

### Objective

Record the confirmed outcome the work must achieve.

Keep it focused on the intended result, without implementation decisions, recovery mechanisms, or verification procedures.

### Intent

Record the confirmed problem, motivation, and desired direction explaining why the objective exists and how it should be interpreted.

Preserve context that materially affects the meaning of success, failure, or acceptable behavior. Do not repeat detailed contracts or implementation decisions.

### Verification Requirements

Record the confirmed guarantees and observable outcomes required for the objective to count as achieved.

Include material requirements concerning intended execution paths, external effects, failure behavior, authoritative outcomes, and boundaries.

State what must be proven, not how to prove it. Do not prescribe verification mechanisms unless a particular path or boundary is itself part of the requirement.

### Definitions

Define domain-specific or repository-specific terms that might otherwise be misunderstood.

### Decisions

Record only decisions, assumptions, and defaults necessary to fulfill the top-level contract consistently.

- Identify existing behavior, responsibilities, and system areas that must remain unchanged. Defer changes crossing that protected scope to a separate plan.

- Require file, module, type, and major function names to reflect their actual responsibilities and remain meaningful beyond the immediate task. Avoid names based only on local implementation context or speculative abstractions.

- Include rationale, constraints, alternatives, or tradeoffs only when needed to understand a decision.

Leave implementation choices that do not materially affect the contract to execution.

### Verification

For each material Verification Requirement, describe the sufficient observable evidence, how it will be obtained, and what establishes pass or failure.

- Use integration or end-to-end verification when the requirement depends materially on the real entry point, orchestration, integrations, external effects, or authoritative readback working together.

- Use narrower verification when it establishes the same material claim.

- Do not substitute evidence that proves a weaker or different claim.

- If full verification is infeasible, state what cannot be demonstrated, why, the closest available verification, and the remaining uncertainty.

- When missing tooling, infrastructure, or observability prevents sufficient verification, include enabling that verification in the planned work when reasonably within scope.

### Verification Tools

List the tools or mechanisms that can produce or observe the required evidence, briefly stating what each can verify.
