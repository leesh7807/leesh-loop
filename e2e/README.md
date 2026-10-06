# Repository E2E harness

Run the production Publisher → Operator → Symphony → worker flow from the repository root with
`npm run e2e`. From a Symphony worker workspace, request a run with the same `npm run e2e` command;
the E2E-owned boundary starts its independent run while preserving the worker as outer provenance.
Both entry points use the same detached E2E execution
boundary, lifecycle, and database reservation contract. The top-level harness owns run preparation,
runtime isolation, database recovery, finalization, and evidence.

There is no user-managed E2E Project configuration file. The root `project.toml` is authoritative
for the production Git repository, configured base branch, Codex model, and Codex reasoning effort.
E2E owns its sandbox-compatible default workflow and policy. For every run, E2E writes an isolated
`project.toml` under that run's directory and passes it to the ordinary Operator start/stop entry
points. It contains the run-owned workflow snapshot, workspace and state paths, run base branch,
readiness/browser controls, and dynamically allocated ports. Port-conflict retries update that
same TOML before restarting. A supplied workflow remains a run input:

```sh
npm run e2e -- --workflow ./custom-workflow.md
```

With no `--plan`, a catalog workload is selected after one database reservation succeeds. A supplied
Accepted Plan is passed through the existing Publisher path:

```sh
npm run e2e -- --plan ./accepted-plan.md
npm run e2e -- --plan ./accepted-plan.md --hard-cap-ms 600000
```

`LEESH_LOOP_E2E_NOTION_DATABASE_URL` is the legacy single-URL input and starts the initial pool with
the four empty database URLs in `model/e2e-runtime-config.mjs`. Set
`LEESH_LOOP_E2E_NOTION_DATABASE_URLS` to replace that set with newline- or comma-separated URLs.
Candidate order and pool size do not define database identity. Reservations and recovery authority
use one compare-and-swap current-state ref per active database or run in the configured production
repository. Historical sequence refs are folded into current state and removed during admission
reconciliation; settled reservation and lifecycle refs are removed after cleanup is read back.

The E2E harness resolves `NOTION_TOKEN` from its repository execution environment. Its child runtime
receives the selected database URL and run-scoped Operator settings; `.env`, production workspace
paths, fixed ports, and production `workspace_files` are not copied into the child worker. Machine
records such as `run.json` and runtime state remain JSON; only Project configuration uses TOML.
Default E2E runtime files stay under `e2e/runs/<run-id>` and `e2e/workspaces/<run-id>` in the current
checkout.

Inspect the pool and run the unconditional recovery pass without starting a workload:

```sh
node e2e/cli.mjs admit
```

Detailed run records preserve run origin, database identity, child runtime identity, lifecycle
observations, workflow/workload snapshots, finalization, cleanup, and authoritative evidence for
in-flight diagnosis. Each terminal invocation also writes a compact, run-specific summary to
`e2e/history/runs/<run-id>.md` in the checkout that invoked it. The summary is an ordinary working
tree change; the harness does not stage, commit, push, or open a delivery for it. Worker-originated
summaries can travel with the worker's existing repository delivery.
