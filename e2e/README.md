# Repository E2E harness

Run the production Publisher → Operator → Symphony → worker flow from the repository root with
`npm run e2e`. From a Symphony worker workspace, request a run with the same `npm run e2e` command;
the E2E-owned boundary starts its independent run while preserving the worker as outer provenance.
Both entry points use the same detached E2E execution
boundary, lifecycle, and database reservation contract. The top-level harness owns run preparation,
runtime isolation, database recovery, finalization, and evidence.

There is no E2E Project configuration file. `operator/project.json` is authoritative only for the
production Git repository, configured base branch, Codex model, and Codex reasoning effort. E2E
owns its sandbox-compatible default workflow and policy. A supplied workflow remains a run input:

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
Candidate order and pool size do not define database identity. Reservations and recovery evidence
are conditional Git events under `e2e-internal` refs in the configured production repository.

The E2E harness resolves `NOTION_TOKEN` from its repository execution environment. Its child runtime
receives the selected database URL and normal Operator runtime configuration; `.env`, production
workspace paths, fixed ports, and production `workspace_files` are not copied into the child worker.
Default E2E runtime files stay under `e2e/runs/<run-id>` and `e2e/workspaces/<run-id>` in the current
checkout.

Inspect the pool and run the unconditional recovery pass without starting a workload:

```sh
node e2e/cli.mjs admit
```

Run records preserve run origin, database identity, child runtime identity, lifecycle observations,
workflow/workload snapshots, finalization, cleanup, and authoritative evidence. Reservation events
are shared across workspaces; other checkouts can read the current lifecycle and recovery result by
stable database identity.
