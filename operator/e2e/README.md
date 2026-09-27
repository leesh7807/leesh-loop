# Production E2E harness

`project.json` is the optional local E2E Project binding and is ignored by Git. When present it
overrides the tracked `project.example.json`; without it, `npm run e2e` uses the example defaults.
The example contains the seed source ref. The E2E CLI needs
`NOTION_TOKEN` and `LEESH_LOOP_E2E_NOTION_DATABASE_URL` in its process environment or in the
repository root's `.env`; it also uses the normal GitHub CLI authentication. When a Project lists
`.env` in `workspace_files`, the file is materialized into the Symphony workspace so a worker can
run nested E2E. The nested E2E and Operator processes use the token; Symphony's existing environment
filtering for Codex worker processes is unchanged. The default workflow is the repository-owned
[`WORKFLOW.md`](WORKFLOW.md), not the production root workflow. Each run creates a run-local
Operator Project with `skip_external_readiness: true` and a nested Symphony workspace under the
current checkout, without requiring a host-global workspace.
Optional `codex_model` and `codex_reasoning_effort` fields are copied independently to the
run-local Project when present; omitted fields leave Codex defaults in control.

Create a local configuration only when the seed or paths need customization:

```sh
cp operator/e2e/project.example.json operator/e2e/project.json
```

Run the admission check first:

```bash
node operator/e2e/cli.mjs admit operator/e2e/project.json
```

Run one workload through the existing production Publisher → `leesh-loop.mjs start` → Operator →
Symphony path. The skip option only omits external readiness; it is not an E2E-specific runtime or
alternate Symphony startup:

```bash
node operator/e2e/cli.mjs run operator/e2e/project.json
```

When a specific Accepted Plan is needed, supply the UTF-8 document directly. The document is passed
unchanged to the production Publisher; it does not need an E2E Markdown schema or H1. The default
hard cap is 30 minutes, and a positive override may be supplied only with `--plan`:

```bash
node operator/e2e/cli.mjs run operator/e2e/project.json --plan ./accepted-plan.md
node operator/e2e/cli.mjs run operator/e2e/project.json --plan ./accepted-plan.md --hard-cap-ms 600000
```

Use `--workflow ./WORKFLOW.md` to supply one exact workflow document for a run. The workflow is
resolved once before the production runtime starts and is copied verbatim into that run's evidence.
There is no catalog-id selector; without `--plan`, catalog random remains the only default workload
selection behavior.

The implementation is grouped by responsibility:

- `model/` contains the E2E project configuration, workload catalog, and durable run record.
- `systems/` contains concrete Notion, Git, GitHub, Operator, Publisher, and `chatgpt-shot` clients.
- `run/admission/` checks whether a new run is safe to start and resolves interrupted runs.
- `run/lifecycle/` interprets observed task states, verifies completion, and observes lifecycle progression.
- `run/finalization/` owns the ordered run stop, terminalization, evidence, cleanup, and isolation checks.
- `run/e2e-runner.mjs` shows the production E2E procedure in order; `cli.mjs` only composes dependencies and invokes it.

Catalog Accepted Plans remain the default workload pool. Before publication, only a catalog-selected
entry is materialized for that execution by adding the next numeric suffix (`-1`, `-2`, ...) to its
H1. A provided Plan is never materialized, even when its content would duplicate a completed
publication; the production Publisher owns and reports that duplicate failure.

Each run stores the resolved workload/workflow snapshots, hashes, provenance, hard cap, runtime
options, actual run-local Operator Project, nested workspace root, and sandbox/runtime conditions in
`operator/e2e/runs/<run-id>/run.json`. The snapshot files and record are outside destructive nested
workspace cleanup and remain durable after finalization.

Production Symphony execution history is captured in those evidence snapshots through
`GET /api/v1/executions?issue_identifier=<identifier>`. E2E observation timestamps remain in the
snapshot envelope; worker start/end/runtime, attempt, session, turn, and token values come from the
production execution records. E2E lifecycle and whole-run durations remain E2E observations.

A terminal run is a useful result even when production stops before `Done`. Inspect
`verified_through`, `verification_gaps`, `failures`, `finalization`, `cleanup` and the evidence
snapshots separately. An unresolved finalization or branch-isolation finding deliberately blocks
the next admission.
