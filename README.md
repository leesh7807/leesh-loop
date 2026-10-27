# Leesh Loop

Leesh Loop manages multiple repository Loops from one local web Operator. The central Manager owns instance data, process control, port allocation, Runtime updates, and Workflow updates. Each Loop Process keeps its own SQLite task store, workspace, configuration, and Workflow, and continues working if the browser or Manager closes.

Leesh Loop currently supports Linux; Manager and Loop lifecycle ownership use Linux procfs to verify process identity safely. On Windows, use WSL2; macOS and BSD are not currently supported. Install Node.js 20.19+ or 22.12+, npm, Git, GitHub CLI, mise, Codex CLI, and configure `chatgpt-shot` on the machine that runs the Loops. The Manager listens on `127.0.0.1` and uses a private per-user token.

## Open the Manager and add repositories

Run the Manager command from anywhere to open the central UI. From the root of a Git repository with a configured upstream, initialize a managed instance:

```bash
leesh-loop
cd /path/to/your-repository
leesh-loop init
```

The first command installs the shared Runtime when needed and opens the Manager at `http://127.0.0.1:4320`. The UI can also add a repository by its local path. `init` and the UI use the same instance registry. They create settings, `WORKFLOW.md`, SQLite data, and workspaces below the user data directory; they do not copy Runtime code into the instance or modify the Git repository.

The sidebar lists every managed repository and its actual Loop state. Select an instance to use its Operator, tasks, comments, Workpad, and Accepted Plan flow. Start or stop only the selected Loop. The CLI equivalents are:

```bash
leesh-loop list
leesh-loop start <instance-id>
leesh-loop stop <instance-id>
leesh-loop update
```

Closing the browser does not stop the Manager or a Loop. Restarting the Manager does not stop a running Loop or its Worker Session. The Manager rediscovers a Loop from its execution record, process identity, readiness files, and runtime endpoint; uncertain ownership is shown as `Unconfirmed` and is not acted on.

## Data and updates

Shared Runtime distributions are stored once under `$XDG_DATA_HOME/leesh-loop/runtimes` (default `~/.local/share/leesh-loop/runtimes`). Runtime installation prepares the shared npm and Symphony Mix dependencies and builds the Operator UI. Per-instance configuration, Workflow, SQLite, and workspaces live below `$XDG_DATA_HOME/leesh-loop/instances/<id>`. Execution records and logs use `$XDG_STATE_HOME/leesh-loop`; Manager settings and the active Runtime pointer use `$XDG_CONFIG_HOME/leesh-loop`; the Hex package cache uses `$XDG_CACHE_HOME/leesh-loop/hex`. Override the XDG roots to relocate these paths.

The Manager assigns an available Symphony port to each Loop. The single Manager Operator uses one address; there is no per-instance UI server. Instance `project.toml` files hold repository and worker settings, not routine port choices.

Runtime updates install an immutable version and make it active for future starts. Running Loops keep their selected version. If an update was started in the Manager UI, run `leesh-loop update` to reload the Manager service onto that active Runtime; this does not stop running Loops. In the Manager, compare each instance's current Workflow with the Runtime template and explicitly apply an update only to a stopped instance. The Manager backs up the prior Workflow before replacing it. Runtime updates do not update Workflow files.

There is no automatic import of the previous per-project registry. Existing directories, databases, workspaces, and processes are left in place. Initialize the Git repositories you want managed by the new Manager.

## Task work

In the Operator, publish a complete Accepted Plan with an H1 and choose its initial State and Blocked By tasks. The Local Publisher derives the identifier and atomically stores the Task and immutable Plan. Task state, Blocked By, comments, Workpad, and Human Review operations retain their existing meanings and are scoped to the selected instance's Local Task Store.

The isolated Local Smoke Run remains available for Symphony and controlled Worker development:

```bash
npm run e2e
npm run e2e -- --mode interactive
```

## Development checks

```bash
npm test
(cd operator/symphony && mise exec -- mix test)
npm run e2e
```

System responsibilities and data boundaries are described in [docs/SYSTEM.md](docs/SYSTEM.md).

<sub>임시 조치: Symphony Codex 작업은 `danger-full-access` / `dangerFullAccess`로 샌드박스가 해제된 상태입니다.</sub>
