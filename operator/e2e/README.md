# Production E2E harness

`project.json` is the fixed E2E Project binding. It intentionally keeps the dedicated Notion
database URL and seed source ref in source control; secrets are read from `NOTION_TOKEN`, the
normal GitHub CLI authentication, and the normal Operator/chatgpt-shot environment.

Run the admission check first:

```bash
node operator/e2e/cli.mjs admit operator/e2e/project.json
```

Run one workload through the production Publisher/Operator/Symphony path:

```bash
node operator/e2e/cli.mjs run operator/e2e/project.json
```

The implementation is grouped by responsibility:

- `model/` contains the E2E project configuration, workload catalog, and durable run record.
- `systems/` contains concrete Notion, Git, GitHub, Operator, Publisher, and `chatgpt-shot` clients.
- `run/admission/` checks whether a new run is safe to start and resolves interrupted runs.
- `run/lifecycle/` interprets observed task states, verifies completion, and observes lifecycle progression.
- `run/finalization/` owns the ordered run stop, terminalization, evidence, cleanup, and isolation checks.
- `run/e2e-runner.mjs` shows the production E2E procedure in order; `cli.mjs` only composes dependencies and invokes it.

The catalog's Accepted Plan is the only E2E input published to Notion. Catalog id, hard cap and
run identity stay in the harness and run record. Run records are written outside destructive
workspace state at `operator/e2e/runs/<run-id>/run.json`; the directory is ignored by Git so the
evidence remains local and durable across workspace cleanup.

A terminal run is a useful result even when production stops before `Done`. Inspect
`verified_through`, `verification_gaps`, `failures`, `finalization`, `cleanup` and the evidence
snapshots separately. An unresolved finalization or branch-isolation finding deliberately blocks
the next admission.
