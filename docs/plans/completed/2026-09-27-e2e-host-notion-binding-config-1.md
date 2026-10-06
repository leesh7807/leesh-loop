# 2026-09-27-e2e-host-notion-binding-config-1

## Objective

`docs/SYSTEM.md` contains a short Production E2E configuration note naming the host-side `NOTION_TOKEN` and `LEESH_LOOP_E2E_NOTION_DATABASE_URL` inputs and linking to `e2e/README.md` for setup details.

## Intent

Surface the existing host-side Production E2E inputs and direct operators to the E2E setup guide.

## Verification Requirements

- The note names both requested inputs and links to `e2e/README.md`.
- No secret values are included and configuration behavior is unchanged.
- `e2e/README.md` confirms both names and the `npm run e2e` setup path; `e2e/model/e2e-runtime-config.mjs` confirms the legacy database URL is resolved from the environment or env file and used to build the database pool.
- `git diff --check` passes.

## Decisions

- Keep the change limited to `docs/SYSTEM.md`; do not alter runtime configuration.
- Document input names only; do not include credential values.

## Verification

Inspect the E2E README for both input names and the `npm run e2e` entry point, and the runtime config for database URL resolution. Inspect the final documentation diff for scope and secret values, then run `git diff --check`.

## Verification Tools

- `e2e/README.md`: establishes both host-side input names and the setup entry point.
- `e2e/model/e2e-runtime-config.mjs`: establishes how the single database URL is loaded and consumed.
- `git diff --check`: detect whitespace errors in the final diff.
