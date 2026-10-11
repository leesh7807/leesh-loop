# Local Task Store E2E

Run the independent Local execution flow with:

```sh
npm run local-e2e
```

Each invocation owns a temporary project, a bare Git target with a `main` base,
a Symphony workspace root, logs, and a SQLite Task Store. It publishes through
the Local Publisher CLI, starts the real Symphony runtime, and lets Symphony's
Codex app-server boundary launch `controlled-worker.mjs`. That controlled
Worker calls the same Local Task tools advertised to normal workers. It does
not start an AI model, contact Notion or GitHub, or create a Repository Plan in
the target Git repository.

The command prints a JSON summary after the Worker completes and the actual
SQLite file has been reopened and checked. Successful runs remove their
temporary resources after readback. Failures preserve the run directory and
report its path, the failed stage, and the Symphony logs. For failure-path
diagnostics, `npm run local-e2e -- --fail-at publisher` exercises publication
failure reporting and `npm run local-e2e -- --fail-at worker-tool` exercises a
failed Local Worker tool call through Symphony.

The controlled Worker is an app-server protocol participant, not a direct
Symphony replacement: Symphony still discovers and accepts the Task, prepares
its workspace, starts the app-server process, routes each `item/tool/call`, and
observes completion through its normal Worker lifecycle.
