# Leesh Loop

Leesh Loop manages Git projects from one local Manager. The Manager owns project registration, Loop controls, shared Runtime updates, and project Workflow updates. Each project keeps separate Task Store, workspace, configuration, and Loop state. A Loop Process continues working if the browser or Manager closes.

Leesh Loop currently supports Linux; Manager and Loop lifecycle ownership use Linux procfs to verify process identity safely. On Windows, use WSL2; macOS and BSD are not currently supported. Install Node.js 20.19+ or 22.12+, npm, Git, GitHub CLI, mise, Codex CLI, and configure `chatgpt-shot` on the machine that runs the Loops. Manager is available at `127.0.0.1` and `localhost` and uses same-origin local authorization.

## Open the Manager and add repositories

Run the Manager command from anywhere to open the project workspace. Add a repository from the **Projects** page after checking its local path and Git upstream, or use the CLI:

```bash
leesh-loop
leesh-loop add /path/to/your-repository
```

The first command installs the shared Runtime when needed and opens Manager at `http://127.0.0.1:4320`. `add` and the UI use the same validation and registry operation. Each requires the Git repository root and a branch with a readable upstream. `leesh-loop init` remains an alias for adding the current repository. Registration creates settings, `WORKFLOW.md`, SQLite data, and workspaces below the user data directory; it does not copy Runtime code into the project or modify the Git repository.

Use **Work** for Task queues and Accepted Plans, **Projects** to switch, register, or unregister a repository, and **System** for the shared Runtime and Manager Service. The current project and Loop status stay visible while moving between these areas. The CLI equivalents are:

```bash
leesh-loop list
leesh-loop start <project-name-or-path>
leesh-loop stop <project-name-or-path>
leesh-loop stop --all
leesh-loop manager stop
leesh-loop update
```

When `start` or `stop` has no project argument, the current directory identifies the project. Duplicate project names require a full repository path. `stop --all` names and stops active project Loops; a Loop whose process ownership is unconfirmed is reported and left untouched. `manager stop` stops only the Manager Service; it verifies the recorded process identity and leaves every Loop and Worker running. Closing the browser tab leaves both Manager and Loops running. Reopen Manager with `leesh-loop`. After a restart, Manager rediscovers Loops from execution records, process identity, readiness files, and their runtime endpoint; uncertain ownership is shown as `Unconfirmed` and is not acted on.

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
