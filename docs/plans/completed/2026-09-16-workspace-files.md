# 2026-09-16-workspace-files

## Objective

Allow a project-local Operator configuration to declare host-local regular files that are copied into each newly-created Symphony workspace after clone and before project bootstrap or worker execution.

## Definitions

Workspace files are absolute host-local regular-file paths declared as `workspace_files` in `project.json`. Their destination is the workspace root joined with their basename. Materialization is the byte-preserving copy into that destination.

## Intent

A fresh clone does not include ignored local files such as the project `.env`. The mechanism must support that use case without treating `.env` or secrets as special.

## Decisions

- `workspace_files` is optional and defaults to an empty list. Its entries must be absolute existing regular files with unique basenames.
- Operator startup validates and normalizes the paths before it can launch a dispatch-capable runtime. The normalized list participates in effective runtime identity.
- The prepared materializer revalidates sources, confines its target to `SYMPHONY_WORKSPACE_ROOT`, refuses all occupied destinations, and never emits file contents.
- `WORKFLOW.md` calls the materializer immediately after clone and before dependency/bootstrap commands. It runs only through `after_create`; continuations do not reapply it.
- No directory, glob, rename, explicit destination, recursive-copy, cleanup, credential-broker, or `.env`-specific behavior is added.

## Verification

Node tests will exercise omitted/empty/valid/invalid configuration, runtime identity, copying and all destination/source/root failure cases. An integration test will execute the repository's `after_create` sequence against an isolated clone fixture, where the first bootstrap command consumes the sentinel file. It will also demonstrate continuation behavior using the preserved workspace. Repository checks and `git diff --check` will run before review.

The highest local verification stops at the actual `after_create` hook command with an isolated repository fixture. Live Symphony dispatch is not run because it would create unrelated external task and worker effects; the remaining risk is a difference in live hook invocation.

## Verification Tools

- Operator Node tests: configuration, runtime identity, materializer, and hook-order regression coverage.
- Temporary filesystem fixtures: isolated sources, workspaces, clone content, and collision cases.
- `npm test` and `git diff --check`: repository checks and patch hygiene.

## chatgpt-shot review log

- Reviewed HEAD: `f705a081109f183032b9b77e9cdfc0d4562c2242`
- Verdict: FINDINGS
- `[high]` accepted: source revalidation was incorrectly applied to `stop`; an invalidated source must prevent new-workspace startup, not lifecycle recovery.
- Applied commit: `af261d8f91f76e6ff9fc78587b611280897a8fc1`
- Verification: `node --test operator/app/test/*.test.mjs` (11 passing); Node syntax checks; `git diff --check`.
