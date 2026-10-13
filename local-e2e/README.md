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

The automatic mode serves the actual Operator UI and uses its HTTP boundary to
publish a Backlog blocker and a Ready Task, read list/detail data, add a Comment,
change Blocked By, and update State. Symphony then dispatches the released Task
to the controlled Worker. The run reopens SQLite and checks it against the
Operator and Worker results. Successful runs remove their temporary resources;
failures retain logs and a summary. `npm run local-e2e -- --fail-at publisher`
checks publication error reporting, and `npm run local-e2e -- --fail-at
worker-tool` checks a failed Worker tool call through Symphony.

For direct browser evaluation, run:

```sh
npm run local-e2e -- --mode interactive
```

The command prints a loopback URL while the Store is still empty. Open it in a
browser to evaluate the Plan form; type `s` and Enter in the terminal to publish
three distinct Backlog Plans and create a fourth Task. Symphony and the
controlled Worker prepare that Task with a Comment and Workpad in Human Review,
then stop. The actual Operator remains available for manual UI changes until
you type `q` and Enter, which stops owned processes and removes the isolated
directory. A setup failure preserves that directory and its logs.

The controlled Worker is an app-server protocol participant, not a direct
Symphony replacement: Symphony still discovers and accepts the Task, prepares
its workspace, starts the app-server process, routes each `item/tool/call`, and
observes completion through its normal Worker lifecycle. Both modes use the
same Local Store, Local Publisher, Operator server/UI, and controlled Worker;
interactive mode adds an explicit preparation command and keeps the web server
open for a person to use.
