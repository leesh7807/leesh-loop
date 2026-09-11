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

- Reviewed HEAD: `1ccba3af2de0fe77ae0d0ac2e8cbc61d40f87f37`
- Verdict: FINDINGS.
- Accepted: environment-reference resolution, accepted State encoding, Plan order, and Workpad
  pagination all had direct runtime evidence.
- Applied commit: `2fed35144a12cb096e9a3af286da84c65e1cce18`.
- Verification: `mix format`, `mix compile`, `mix specs.check`, and `mix test` passed (296 tests,
  0 failures, 6 skipped).
