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
- Reviewed HEAD: `17bad744870fbf9925e6e8259be2b433a597dcf1`.
- Verdict: FINDINGS.
- Rejected: the reported external `Blocked By` relation issue adds a self-relation invariant that
  the accepted contract does not impose; related blocker state is deliberately the defined source.
- Applied commit: none.
- Verification: no code change; prior full local verification remains applicable.
- Reviewed HEAD: `eb1e113e30b3e3216bfde977ea6d975885495953`.
- Verdict: FINDINGS.
- Accepted: `Priority` select was admitted despite lacking a portable numeric normalization rule;
  canonical compatibility now requires number rather than silently dropping the durable value.
- Applied commit: `31cd83c3677903b9c37524a60759fb9b127d01e0`.
- Verification: `mix format`, `mix compile`, and `mix specs.check` passed. `mix test` is blocked by
  two existing `CoreTest` retry due-time lower-bound assertions (observed 487–489ms vs 500ms, and
  39487–39492ms vs 39500ms); this adapter does not touch retry timing.
