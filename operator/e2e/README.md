# Production E2E harness

`project.json` is the local E2E Project binding and is ignored by Git. Copy the tracked
`project.example.json` before first use; it contains the dedicated E2E Notion database binding and
seed source ref. The E2E CLI needs `NOTION_TOKEN` in its process environment or in the current
repository root's `.env`; it also uses the normal GitHub CLI authentication. The token is consumed
by the host-side E2E and Operator processes and is not copied into the nested worker workspace.
Symphony removes tracker secrets from the Codex worker process, so run the E2E CLI from a credentialed
host shell rather than from a worker task shell. The default workflow is the repository-owned
[`WORKFLOW.md`](WORKFLOW.md), not the production root workflow. Each run creates a run-local
Operator Project with `skip_external_readiness: true` and a nested Symphony workspace under the
current checkout, without requiring a host-global workspace.
Optional `codex_model` and `codex_reasoning_effort` fields are copied independently to the
run-local Project when present; omitted fields leave Codex defaults in control.

Create the local configuration from the example:

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

A terminal run is a useful result even when production stops before `Done`. Inspect
`verified_through`, `verification_gaps`, `failures`, `finalization`, `cleanup` and the evidence
snapshots separately. An unresolved finalization or branch-isolation finding deliberately blocks
the next admission.
