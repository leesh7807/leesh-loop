# 2026-09-05-symphony-separation-v2

## Objective

Flatten `symphony/elixir/` into `symphony/` as a complete Elixir project, while preserving the runner, its tests, development documentation, and verification tooling. Keep the coordination repository and runner boundaries distinct.

## Definitions

- **Source**: commit `79f5ff6e5f7cc099668a96f51b30de579c97fa56`; the sole source for implementation and preservation checks.
- **Execution-input WORKFLOW**: a caller-owned file accepted by the Symphony CLI explicitly or as `./WORKFLOW.md` from the caller's current directory.
- **Role-document WORKFLOW**: the coordination repository's Executor responsibility document.

## Decisions

- The Mix project root becomes `symphony/`; apply `symphony/elixir/<path> -> symphony/<path>` unless a documented exception applies.
- Preserve all runner code, adapters and dynamic tools, tests (including snapshots and live E2E), Mix tasks, fixtures, support code, docs, runtime assets, Makefile, formatting policy, and project documents.
- Remove only the specified outer media, workflows, Codex skills/setup helper, smoke-result documents, the bundled execution-input `WORKFLOW.md`, and the superseded outer README.
- Use the Elixir README and AGENTS as the final `symphony/` versions, correcting paths and documentation so a caller can author an input workflow and run the CLI. Do not retain instructions to copy a bundled workflow or deleted skills.
- Preserve the root README body and append only a short runner-location/runtime/use appendix. Preserve root AGENTS except for the user-identified unwanted global execution-WORKFLOW commit prohibition; add the runner-safety and WSL2 boundaries.
- A caller may commit its own workflow. Only actual credentials and environment-specific secrets are prohibited from commits.
- Preserve the Unix/Linux runtime, workspace/path safety, credential isolation, adapter-read/dynamic-tool-write split, retry, concurrency, reconciliation, and CLI acknowledgement behavior.

## Verification

- Compare source and final tree manifests (path, mode, blob), explaining every changed, removed, or relocated file.
- Confirm no `symphony/elixir/` remains, all required root files exist, and no generated build artifacts are tracked.
- In a fresh WSL2 Linux-filesystem checkout, run `mise install`, dependency setup, format checking, `make all`, and `mix escript.build` from `symphony/`; record live-test skips and unavailable credential-dependent runs.
- Exercise the built escript with the acknowledgement flag: a missing explicit workflow must exit 1 with the requested-path error; explicit and default-cwd Memory workflows must start and return HTTP 200 from the status API before cleanup.
- Verify the root README and AGENTS boundaries and that documentation distinguishes role documents from runner inputs.

## Verification Tools

- Git tree, blob, diff, status, worktree, ignore, and remote-ref commands verify preservation, scope, recovery, and publication state.
- WSL2 with mise, Mix, Make, and the escript verify the Linux runtime and full quality gates.
- A temporary Memory workflow plus HTTP client verifies CLI input discovery, startup, and observable runtime state.
- A fresh clone verifies the final published commit and tree after user-approved root-commit publication.
