# Plan Instructions

Create and maintain a plan that keeps the work aligned with the objective and makes completion easy to judge.

- Name each plan document using the format `date-summary`.

- Use the confirmed objective, intent, repository conventions, and available evidence to settle decisions that could change the outcome.

- Do not invent reasons, tradeoffs, or justifications for the user.

- Define verification in terms of observable evidence. The plan must make clear how to tell whether the intended result works through the intended path.

- Fix terminology before planning. Use one term for one meaning.

- Update the plan during execution only when new evidence changes an important assumption, decision, boundary, intent, or verification method.

- Do not use the plan as an execution log.

- Keep active plans under `docs/plans/active/`. After the final Repository Plan comparison and before opening its Pull Request, move the delivered Plan to `docs/plans/completed/`. This repository-artifact move does not itself make the tracker task terminal; human review, merge, or rework may still follow.

When reviewing the plan, check that each planned unit describes a coherent outcome in the problem domain rather than merely an implementation step.

A good planned unit should:

- describe one meaningful responsibility or capability;

- have a result that can be understood and verified on its own;

- avoid combining unrelated responsibilities just to reduce the number of units.

Do not split the plan just to make the work easier for an agent.

If you cannot turn a planned unit into a clear executable issue, check whether you understand its scope and domain boundary well enough.

The final plan should be complete enough for implementation to begin without unresolved planning decisions that could change the objective or its boundaries.

## Plan format

```markdown
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

Include rationale, constraints, alternatives, or accepted tradeoffs only when they are needed to understand a recorded decision.

Do not repeat background already captured in Intent.

## Verification

Describe the observable evidence that will show whether the objective has been achieved through the intended execution path.

## Verification Tools

List the tools or mechanisms that can produce or observe the required evidence, and state briefly what each one can verify.
```

## chatgpt-shot review log

Append a compact summary after every independent-review round when a repository workflow requires `chatgpt-shot`: reviewed HEAD, verdict, each finding's evidence-based acceptance or rejection, any applied commit, and post-change verification. This is a review ledger, not a substitute for the task Workpad or Repository Plan.

### 2026-09-11 round 1

- HEAD: `be9ba538d506b8c07b1544530b07d7a6484b42eb`; verdict: `FINDINGS`.
- Rejected P1: current embedded Symphony has no Notion adapter, but the Accepted Plan expressly treats normal Publisher/adapter/Notion delivery as an execution premise and forbids proactively changing Publisher. The root workflow declares that external adapter contract; replacing it with an unrelated supported tracker or implementing a new adapter would change the accepted scope. The limitation is recorded in the PR verification comment.
- Accepted P1 (fresh Plan): the template incorrectly made a missing local Plan an automatic blocker although a valid Accepted Plan can originate from an uncommitted local file. It now materializes only the deterministic missing path from the Accepted Plan and preserves any existing corrected Repository Plan.
- Accepted P2 (Plan move): moving only after a terminal tracker transition conflicted with the non-terminal Human Review flow. The delivered Plan now moves to `completed/` after final comparison and before its PR; that artifact move is explicitly separate from task terminal state.
- Applied commit: `2e0eb00d21842fba490e58ed6a5b60ee27da596d`; post-fix verification: `npm test` (34/34), strict Symphony workflow parse/render, `workspace_and_config_test.exs` (54/54), and `git diff --check` passed.

### 2026-09-11 round 2

- HEAD: `fa25906052c27f138c2291b0b863b86cfb6d25a8`; verdict: `FINDINGS`.
- Accepted P1: Human Review to Rework lacked the deterministic completed-to-active Plan restoration required before continued work. The concrete workflow now defines that non-terminal restore without Plan search.
- Accepted P2: this delivery Plan had not followed the new pre-PR artifact rule. It is now at `docs/plans/completed/2026-09-11-workflow-contracts.md`.
- Applied commit: `037eafc`; verification: `git diff --check` passed. A new HEAD requires re-review.
