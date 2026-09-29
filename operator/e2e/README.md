# Production E2E harness

`project.json` is the tracked default E2E Project binding. It uses paths relative to this directory,
so a checkout can run it without embedding a user's home directory. The E2E CLI reads `NOTION_TOKEN`
and `LEESH_LOOP_E2E_NOTION_DATABASE_URL` from its process environment or the repository root's
`.env`; it also uses the normal GitHub CLI authentication. The E2E run passes the E2E database URL to
its Operator process. The run-local Operator Project does not list `.env` in `workspace_files`, so
the root `.env` is not copied into the nested Symphony workspace. Symphony's existing environment
filtering for Codex worker processes is unchanged. The default workflow is the repository-owned
[`WORKFLOW.md`](WORKFLOW.md), not the production root workflow. Each run creates a run-local
Operator Project with `skip_external_readiness: true` and a nested Symphony workspace under the
current checkout, without requiring a host-global workspace.
Optional `codex_model` and `codex_reasoning_effort` fields are copied independently to the
run-local Project when present; omitted fields leave Codex defaults in control.

The default configuration is ready to use once credentials are available. For a separate custom
configuration, create another JSON file under this directory and pass its path to the CLI:

```sh
node operator/e2e/cli.mjs run operator/e2e/project.local.json
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
- `run/finalization/` owns the ordered run stop, terminalization, evidence, and owned-resource cleanup/readback.
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
snapshots separately. Admission rechecks unresolved owned resources, including the run-scoped base,
the task's recorded delivery branch, runtime and workspace. Changes to unrelated repository branches
are not run residue and do not block admission.
