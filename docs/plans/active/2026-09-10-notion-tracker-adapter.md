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
- Reviewed HEAD: `9fd44ce24f25d6880d53df91a3e2b1c69b3bd6be`.
- Verdict: FINDINGS.
- Accepted: the comments capability omitted Notion's required `block_id`; comments now use a
  separate page-scoped query from block-child pagination.
- Applied commit: `8678a89eb8edf9222c3e15f7de8a01c03fab7627`.
- Verification: `mix format`, `mix compile`, and `mix specs.check` passed; the known unrelated
  retry-timing test instability remains recorded above.
- Reviewed HEAD: `8e1ebbb0415bebb869b0dea689626c36fc3fe64a`.
- Verdict: FINDINGS.
- Accepted: paginated relation items need `relation.id`, and comment pagination must preserve
  provider order.
- Applied commit: `1c1750a87ec7659166660b3626cc4006aa375d0d`.
- Verification: `mix format`, `mix compile`, and `mix specs.check` passed.
- Reviewed HEAD: `5b68fcb184a18c953fe79bfc013d4e49eabd5fff`.
- Verdict: PASS (`None.`).
- Findings: none.
- Applied commit: none.
- Verification: no change after the clean review.
- Reviewed HEAD: `5fa68e7cf043322e2940380b993e66b69bf0bbc9`.
- Verdict: FINDINGS.
- Accepted: valid decimal Notion number priority is rounded into Symphony's portable integer rank.
- Applied commit: `4c0e85f01119b666ae977ab5c8ed6ffb7b5dd07e`.
- Verification: `mix format`, `mix compile`, and `mix specs.check` passed.
