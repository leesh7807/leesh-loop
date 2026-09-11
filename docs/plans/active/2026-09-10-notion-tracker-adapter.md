# 2026-09-10-notion-tracker-adapter

## Objective

Add a `tracker.kind: notion` adapter in `symphony/` that uses the canonical direct-child Notion
task representation through the existing tracker boundary.

## Decisions

- Use Notion API `2025-09-03` and resolve exactly one compatible task data source from the database
  container.
- Normalize only canonical metadata plus exactly-one direct `Plan` and `Workpad`; do not interpret
  headings or free-form content.
- Keep provider-specific dispatchability limited to resolved `Blocked By` terminal-state checks.
- Bind the provider settings, data-source identity, page identity, and worker tools when a session
  starts so reload cannot retarget an existing worker.

## Verification

- Compile, spec checks, unit suite, and project quality gate pass.
- A live Notion exercise is recorded as skipped when no disposable credential/surface is supplied.

## chatgpt-shot review log

Pending initial review.
