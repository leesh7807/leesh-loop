# 2026-09-10-workflow-contracts

## Repository Plan Reference

`docs/plans/active/2026-09-10-workflow-contracts.md`

## Objective

Define Leesh Loop planning and execution contracts so repository agents can execute published Plans autonomously without treating the original Plan as an immutable prediction of every implementation step. This work does not modify Symphony source code or implement the Notion adapter. It configures this repository's future Symphony runtime through `WORKFLOW.md`, including workspace checkout, and corrects the Publisher's existing user-facing description text from “completed artifact” to “accepted Plan snapshot.”

## Decisions

- `docs/PLAN.md` owns Plan content and durable-update guidance. `docs/WORKFLOW_TEMPLATE.md` is the single normative home for reusable worker execution semantics. Root `WORKFLOW.md` supplies only this repository's Symphony configuration, task prompt, and delivery/verification extensions. README explains architecture and links to the contract.
- The Plan declares its repository-relative active materialization path. Future Publisher publication captures the target repository's current base commit and writes both values into normalized Description while preserving the accepted Plan snapshot independently as task content. The future adapter copies Description unchanged to Symphony `Issue.description`; the workflow renders it, checks out the base commit, reads the immutable accepted snapshot through the task surface, and materializes it before reading the Plan. No new Symphony issue field and no Plan parsing in the adapter are required.
- Each Symphony workspace clones this repository in `hooks.after_create` before the worker prompt starts; the worker checks out the published base commit and materializes the accepted Plan snapshot before resolving the Plan path.
- A compliant Leesh Loop adapter provides a separate authenticated agent-side task surface for immutable Plan snapshot read, idempotent Workpad read/append, decision/blocker recording, and task-state transitions with readback. It remains separate from adapter reads.
- Initial binding writes a Workpad checkpoint. Normal follow-up attempts resume the existing workspace, branch, Workpad, and durable Plan corrections without re-checkout or snapshot rematerialization; missing or inconsistent continuation state is an operator recovery blocker.
- Binding/recovery blockers and material human judgment transition through the task surface to repository-defined non-dispatchable states with authoritative readback. Autonomous implementation and independent review remain runnable.
- Symphony `attempt` is diagnostic context, not binding authority. The template classifies initial binding, a missing-checkpoint safe retry, and continuation from the Workpad checkpoint plus workspace/materialized Plan state. A clean clone may start at a later default-branch HEAD, so initial binding always checks out the published base commit before snapshot materialization and checkpoint creation. The root workflow renders attempt context. Human-judgment trigger semantics remain solely in the template.
- Completion uses Workpad intent and repository-finalized checkpoints before the idempotent terminal task transition. Terminal readback ends the task lifecycle; later work uses a new Plan and a new task.
- Publisher does not plan, execute, synchronize later repository Plan changes, or make workflow decisions. The published Plan is an immutable accepted starting snapshot, not a completed task artifact.
- `AGENTS.md` is corrected because its project map was an authoritative navigation entry point with stale paths and a duplicate top-level heading.

## Verification

- Review the template, root workflow, Plan instructions, README, Publisher documentation, and `AGENTS.md` for one owner per rule and no contradictory lifecycle language.
- Confirm the root workflow has Symphony YAML front matter, an `after_create` repository checkout, and Liquid task context including `issue.description`; confirm the template pins checkout to the published base commit and materializes the immutable Plan snapshot before Plan resolution.
- Confirm the template requires the separate agent-side mutation surface and defines checkpointed recovery only before terminal readback.
- Confirm the template differentiates initial binding from follow-up attempts and makes binding or human-judgment stops scheduler-visible through non-dispatchable state readback.
- Confirm the root prompt renders `attempt` without treating it as binding authority, and does not narrow the template's human-judgment triggers.
- Confirm a pristine clone and a snapshot-only partial binding both check out the published base commit before the binding checkpoint is written.
- Confirm Publisher text calls the Plan an accepted snapshot rather than a completed artifact, without changing publication mechanics.

## Verification Tools

- Repository document review and `git diff --check` validate structure, scope, and cross-document consistency.
- Upstream Symphony README, specification, `PromptBuilder`, and workflow fixture validate workspace-hook and prompt-template behavior.
- Publisher source and tests validate the existing task Description vocabulary.
