# 2026-09-10-workflow-contracts

## Repository Plan Reference

`docs/plans/active/2026-09-10-workflow-contracts.md` at publication. The Plan stays there through Pull Request review and any rework. It becomes historical provenance only after terminal completion moves it to `docs/plans/completed/`.

## Objective

Define Leesh Loop planning and execution contracts so repository agents can execute published Plans autonomously without treating the original Plan as an immutable prediction of every implementation step. This work changes documentation and execution contracts only. It does not implement the Notion tracker adapter, change Symphony runtime behavior, or change Publisher behavior.

## Definitions

- **Plan**: a durable repository artifact recording the accepted objective, boundaries, important decisions, assumptions, constraints, and verification design. It is complete enough to begin execution without unresolved decisions that could materially change the accepted objective or its boundaries; it is not a prediction of every implementation step.
- **Execution discovery**: information learned only while performing work, including repository facts, runtime behavior, integration constraints, invalid assumptions, additional necessary implementation work, or verification limitations not knowable with sufficient confidence during planning. It is expected and is not itself a planning failure.
- **Durable planning knowledge**: execution discovery that should remain useful after execution because it changes the correct understanding of the work, including material corrections to assumptions, responsibility boundaries, constraints, accepted implementation requirements, verification methods, or repository/integration behavior relevant to completed work. It belongs in the repository Plan.
- **Workpad**: the mutable execution surface for current-task progress, attempts, command output, temporary failures, investigation notes, intermediate evidence, blockers, and handoff state. It is not a substitute for durable repository knowledge.
- **Follow-up work**: meaningful work discovered during execution that is not required for the current accepted objective. It is separated rather than absorbed into the current task.
- **Workflow template**: a reusable Leesh Loop execution-contract template with no repository-specific commands, paths, tools, or delivery details.
- **Repository workflow**: a target repository's concrete `WORKFLOW.md`, combining Symphony runtime configuration with its repository-specific execution prompt and applying common Leesh Loop workflow semantics.
- **Repository Plan reference**: the exact repository-relative active Plan path declared by a Plan at publication. Publisher validates it and makes normalized Description begin with `Repository Plan Reference: <repository-relative path>`; the tracker adapter carries that Description unchanged as Symphony `Issue.description`. It identifies the one repository Plan that the worker may read and update.

## Decisions

### Plan authority during execution

The Plan is the accepted planning baseline, not an immutable implementation sequence. When repository or runtime evidence requires it, an executor may autonomously change approach; touch additional files or components; add necessary tests or verification; replace disproved technical assumptions; and refine insufficient or invalid verification. It does not need human approval merely because the implementation path differs. Work necessary to complete the accepted objective remains in the current task even if the Plan did not anticipate it.

### Plan updates and Workpad

Update the repository Plan when execution reveals durable planning knowledge. Do not update it to mirror execution history, and do not require approval merely to make a durable correction. Important false assumptions, changed responsibility boundaries, necessary implementation responsibilities, invalid original verification methods, and durable constraints belong in the Plan. Transient command failures, attempts, progress, and intermediate evidence remain in the Workpad.

### Human judgment boundary

Return to human judgment only when evidence requires changing the accepted objective, a material product decision, a material external contract or compatibility decision, an accepted boundary into a materially different capability, or selecting among materially consequential alternatives not already settled. Ordinary implementation discovery, failed approaches, necessary additional work, and verification refinement do not require escalation.

### Follow-up work and publication

Separate meaningful work that concrete evidence shows is outside the current objective. A follow-up must have an independently understandable outcome and independently judgeable completion, and defining it must not invent a material product or contract decision. Do not create speculative follow-ups for optional improvements. If a follow-up depends on an undecided material choice, surface that choice for human review instead.

The intended path is execution discovery → follow-up Plan artifact → Publisher → Notion task. This plan defines the semantic contract only: it does not implement agent-to-Publisher invocation, relation writing, or adapter tooling.

### Published and repository Plans

The Plan published to Notion represents the accepted planning state that started the task. The repository Plan may later be corrected with durable planning knowledge. The Workpad records execution history between those points. Do not add Plan synchronization to Publisher.

Each execution-eligible Plan declares its exact active repository-relative Plan path at publication in its `Repository Plan Reference` section. Publisher validates it and makes normalized Description begin with `Repository Plan Reference: <repository-relative path>`; the future tracker adapter carries that existing Description unchanged into Symphony `Issue.description`. Root `WORKFLOW.md` renders `{{ issue.description }}` and the worker opens and may update only that exact referenced file. The worker must not scan or infer from `docs/plans/active/`. Missing, malformed, invalid, or unresolved references block execution and are surfaced for resolution. Until Publisher and the adapter expose this carrier, publication may occur but autonomous execution under this workflow cannot begin.

The referenced Plan stays active throughout implementation, Pull Request review, and resulting rework. Only after all required review and delivery work is complete does terminal completion move it to `completed/` and transition the task terminally. If a terminal task reopens, restore the Plan to its original referenced active path before it becomes dispatchable again.

### Template and repository workflow

Add `docs/WORKFLOW_TEMPLATE.md` for reusable semantics: reading accepted tasks, evidence-led execution, Plan-versus-Workpad updates, follow-up work, human-judgment boundaries, verification, completion, and repository-delivery extension points. It must not contain repository commands, tests, GitHub URLs, `chatgpt-shot` details, or fixed tracker-provider configuration.

Add root `WORKFLOW.md` for this repository. It applies common semantics and specifies `AGENTS.md` authority, the `symphony/` boundary, active/completed Plan lifecycle, repository verification, worktree/branch/commit/push/PR/review flow, independent review where required, and human-review conditions without duplicating `AGENTS.md`.

Keep it structurally compatible with Symphony: YAML front matter is runtime configuration and the Markdown body is the worker prompt. Since the Notion adapter is not implemented, leave its tracker-specific binding explicitly unresolved rather than invent unsupported configuration. Workflow semantics must not depend on the adapter.

### Component boundaries

The future Notion adapter translates Notion coordination into Symphony's tracker interface, including candidate reads, issue normalization, refresh/state data, blocker semantics, the already-normalized Description, and agent-side mutation surface. It does not plan or parse Plans. Publisher takes a Plan artifact, validates its declared reference, normalizes it into Leesh Loop task structure by placing the reference in Description for execution-eligible work, and publishes it to the configured Notion surface; it does not plan, execute, synchronize later Plan edits, or make workflow decisions.

## Verification

Repository document review and scenario walkthrough must establish one coherent model across `docs/PLAN.md`, `docs/WORKFLOW_TEMPLATE.md`, `WORKFLOW.md`, `README.md`, and `AGENTS.md`:

- A disproved implementation assumption allows autonomous adaptation, keeps necessary additional work in the task, writes durable corrections to the Plan, leaves transient detail in the Workpad, and needs no approval solely for the changed path.
- A resolved temporary command failure belongs in the Workpad, while proof that an important Plan assumption is false updates the repository Plan.
- A new product, compatibility, architecture-contract, or scope decision not already accepted returns to human judgment.
- Necessary but unlisted implementation work stays in the current task.
- Meaningful unnecessary work becomes a separate follow-up Plan on the normal Publisher path; speculative improvements are not automatically published.
- A task with two active Plans or a Plan published from an arbitrary external path still receives its reference in the first normalized Description line and opens only that file; absent or invalid references block rather than permitting scanning or inference.
- A worker prompt renders `issue.identifier`, `issue.title`, `issue.state`, `issue.url`, and `issue.description`, so the rendered session includes both task context and the carrier.
- The bound Plan remains active while a Pull Request is reviewed and reworked, then moves only at terminal completion; reopening restores its active path before redispatch.
- The reusable template has only common semantics and extension points; the root workflow has this repository's concrete behavior without duplicating `AGENTS.md`.
- Documentation does not imply that Publisher executes Symphony or synchronizes final Plan edits, that the adapter plans or parses Plans, or that the adapter must exist before the workflow contract.
- The concrete workflow has YAML runtime configuration and a Markdown prompt body and invents no unsupported Notion adapter fields.

## Verification Tools

- Repository document review compares the five guidance documents and `AGENTS.md` for contradictory definitions, duplicated authority, and component-boundary drift.
- Upstream Symphony README and specification verify the workflow configuration/prompt format and the compatible execution model.
- Existing Publisher documentation verifies that the contract does not expand Publisher responsibilities.
- A scenario walkthrough verifies that every stated execution case has one clear outcome.
