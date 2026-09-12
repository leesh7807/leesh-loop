# 2026-09-11-canonical-notion-task-representation

## Objective

Publish each Plan as one deterministic executable Notion task: six durable task
properties plus exactly one direct `Plan` child page and one direct `Workpad`
child page. `Plan` holds the immutable accepted Plan; `Workpad` is the mutable
execution record. Publication remains recoverable through `Publisher Pending`.

## Decisions

- The required schema is `Identifier`, `Title`, `State`, `Priority`, `Labels`,
  and `Blocked By`; legacy and unrelated properties are ignored, never deleted.
- `Plan` and `Workpad` are fixed native child-page names, not body headings.
- A task remains `Publisher Pending` until both surfaces and complete Plan
  content are validated, then moves to the requested initial state.
- Lookup rejects every multiple-Identifier result. A sole pending record is
  repaired; a sole non-pending record is a duplicate.
- Completed records are never reclassified or repaired from later structure
  changes.

## Verification

- Unit and fake-provider tests cover schema, child-page creation, finalization,
  recovery, ambiguous identifiers, and completed-task structural damage.
- TypeScript compilation and the complete publisher test suite pass.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `4fb2b54cb651d19770a1a1d4063253ffdb3cbb11`
- Verdict: FINDINGS
- Rejected: “Pending repair can finalize a task with a non-empty Workpad.” The
  accepted contract permits a Workpad to be empty; it does not require emptiness
  as a canonical invariant. The proposed reproduction injects arbitrary content
  into an incomplete record and is not a defect in normal publisher behavior.
- Applied commit: none.
- Verification: `cd notion_publisher && npm test` passed (14/14); `git diff --check` passed.
