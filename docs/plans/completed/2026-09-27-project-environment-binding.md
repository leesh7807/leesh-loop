# 2026-09-27-project-environment-binding

## Objective

Resolve production and E2E Notion database URLs from distinct process environment
bindings or the repository-root `.env`. Do not store real database bindings in
tracked Project examples or E2E source. Allow Project-local path values to use
absolute paths, paths relative to the Project configuration file, and `~` for
the current user's home directory.

## Accepted intent and boundaries

Notion database URLs are external bindings that cannot be reconstructed from a
checkout or Git metadata. `.env` supplies those values to host processes and can
also be passed into a Symphony worker workspace through `workspace_files`, so a
nested `npm run e2e` can use its dedicated database. `.env.example` documents
the names without including credentials or real database URLs.

Keep production and E2E bindings separate. Process environment takes precedence
over repository-root `.env`. Derive the E2E database ID from the resolved E2E
URL. Preserve existing absolute path behavior; resolve relative paths from the
Project configuration directory and expand `~` before existing validation and
canonicalization. Apply path expansion at least to `workspace_files`, and to
other straightforward local path fields where existing semantics permit it.

Do not change repository/deployment layout policy, Publisher lifecycle,
Symphony dispatch semantics, worker credential filtering, E2E workload
selection or lifecycle/finalization, or browser behavior. Preserve existing
path safety and arbitrary local deployments.

## Required outcomes

1. Production Project JSON and its tracked example do not require or contain a
   Notion database URL. Production Operator, Publisher, and Symphony paths use
   `LEESH_LOOP_NOTION_DATABASE_URL` from process environment or repository-root
   `.env`; missing input fails with the variable name before database-dependent
   work begins.
2. E2E Project JSON, its tracked example, and tracked E2E source contain no
   actual database URL or fixed database ID. E2E resolves
   `LEESH_LOOP_E2E_NOTION_DATABASE_URL` from process environment or
   repository-root `.env`, then derives its database ID from that URL.
3. A Symphony worker can materialize repository-root `.env` using a relative
   `workspace_files` entry and run the real nested `npm run e2e` with the
   dedicated E2E binding.
4. `.env.example` names `NOTION_TOKEN`, `LEESH_LOOP_NOTION_DATABASE_URL`, and
   `LEESH_LOOP_E2E_NOTION_DATABASE_URL` without actual values.
5. Absolute, Project-relative, and `~` local paths pass through existing path
   validation and canonicalization. Workspace source paths remain validated
   regular files and materialization retains its current containment and
   no-overwrite behavior.

## Verification

- Focused tests cover environment precedence, repository-root `.env` lookup,
  clear missing-binding failures, runtime E2E database-ID derivation, and
  absolute/relative/home-expanded workspace paths.
- Inspect tracked examples and E2E source for the former actual URL and fixed
  ID; inspect `.env.example` for the required variable names and absence of
  actual credentials or database URLs.
- Run the production Operator binding path and verify its runtime/readback when
  the production Project/runtime configuration is available.
- Verify nested `.env` materialization and run the actual `npm run e2e` from a
  Symphony worker workspace when that execution surface is available; confirm
  the dedicated database through E2E evidence and Notion readback.
- Run affected Operator and E2E suites and `git diff --check`.
