# 2026-09-10-workflow-contracts

## Repository Plan Reference

`docs/plans/active/2026-09-10-workflow-contracts.md`

## Objective

Define Leesh Loop planning and execution contracts so repository agents can execute published Plans autonomously without treating the original Plan as an immutable prediction of every implementation step. This work changes documentation and execution contracts only, except for the Publisher's existing user-facing description text being corrected from “completed artifact” to “accepted Plan snapshot.” It does not implement the Notion adapter or change Symphony runtime behavior.

## Decisions

- `docs/PLAN.md` owns Plan content and durable-update guidance. `docs/WORKFLOW_TEMPLATE.md` is the single normative home for reusable worker execution semantics. Root `WORKFLOW.md` supplies only this repository's Symphony configuration, task prompt, and delivery/verification extensions. README explains architecture and links to the contract.
- The Plan declares its repository-relative active path. The future Publisher validates that declaration and writes `Repository Plan Reference: <path>` as the first normalized Description line; the future adapter copies Description unchanged to Symphony `Issue.description`; the workflow renders that existing field. No new Symphony issue field and no Plan parsing in the adapter are required.
- Each Symphony workspace clones this repository in `hooks.after_create` before the worker prompt starts.
- A Plan remains active through PR review and rework. Terminal completion moves it to completed. A reopened terminal task is binding-blocked until the operator who reopens it restores the Plan to its referenced active path and only then makes the task dispatchable.
- Publisher does not plan, execute, synchronize later repository Plan changes, or make workflow decisions. The published Plan is an immutable accepted starting snapshot, not a completed task artifact.
- `AGENTS.md` is corrected because its project map was an authoritative navigation entry point with stale paths and a duplicate top-level heading.

## Verification

- Review the template, root workflow, Plan instructions, README, Publisher documentation, and `AGENTS.md` for one owner per rule and no contradictory lifecycle language.
- Confirm the root workflow has Symphony YAML front matter, an `after_create` repository checkout, and Liquid task context including `issue.description`.
- Confirm the template assigns reopen restoration to the reopening operator and keeps reopened work non-dispatchable until restoration.
- Confirm Publisher text calls the Plan an accepted snapshot rather than a completed artifact, without changing publication mechanics.

## Verification Tools

- Repository document review and `git diff --check` validate structure, scope, and cross-document consistency.
- Upstream Symphony README, specification, `PromptBuilder`, and workflow fixture validate workspace-hook and prompt-template behavior.
- Publisher source and tests validate the existing task Description vocabulary.
