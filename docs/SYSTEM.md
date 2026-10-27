# System responsibilities and configuration

## Process and data boundaries

The Manager Service, Manager UI, and each Loop Process have independent lifecycles. The UI is served on IPv4 and IPv6 loopback where available, so `127.0.0.1` and `localhost` reach the same local Manager. The Manager starts and stops Loop Processes but does not relay Worker activity. A Loop uses its own Symphony, Local Task Store, workspace root, settings, and `WORKFLOW.md`; it continues task processing if the Manager or browser closes. `leesh-loop manager stop` stops only the Manager Service after verifying its process identity and authenticated API response; it does not stop a Loop or Worker.

The Manager's process records are advisory until verified against the operating system and the Loop's own readiness data. A Loop is `Running` only when its PID start identity, runtime ownership record, dispatch acknowledgement, assigned dashboard address, and runtime status endpoint agree. PID reuse, missing records, incomplete startup, and ownership mismatches are surfaced as `Unconfirmed` or `Failed`; the Manager does not signal an unverified process.

The Manager binds only to loopback addresses and accepts the exact `127.0.0.1`, `localhost`, or `[::1]` Host for its configured port. API requests require a private Runtime-bound token and same-origin checks; the browser obtains that token through a same-origin request protected by Origin and Fetch Metadata. The token is kept in page memory, refreshed after an authorization failure, and is not placed in a local file bootstrap or browser storage. The Manager exposes named project, process, Runtime, Workflow, and Task operations, never a shell command endpoint. Task Store operations open the selected instance's SQLite database and retain the existing Local Publisher and Store contracts.

## User directories

XDG directories separate shared Runtime, durable instance data, process state, and user configuration:

| Data | Default path | Contents |
| --- | --- | --- |
| Data | `~/.local/share/leesh-loop` | Instance registry, instance data, immutable versioned Runtime distributions, and shared Mix home |
| State | `~/.local/state/leesh-loop` | Manager service record, logs, Loop execution identity, process logs, and assigned ports |
| Config | `~/.config/leesh-loop` | Active Runtime pointer, Runtime source, and Manager port ranges |
| Cache | `~/.cache/leesh-loop` | Hex package cache used while preparing Runtime distributions |

`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` override those roots. Managed directories are private to the local user. Each instance receives a stable UUID and an independent directory under `instances/<id>` containing `project.toml`, `WORKFLOW.md`, `state/local-task-store/local-task-store.sqlite`, and `workspaces/`. Runtime source is not copied into that directory. Normal creation does not add `.env.example` and does not change the target repository.

The registry is a new source of truth. Existing per-project registries are not imported or modified. Existing instance files and processes are left untouched; users reinitialize the repositories they want to manage.

## Instance creation and worker configuration

`leesh-loop add [path]`, the compatibility command `leesh-loop init`, and the Manager UI call the same Manager Service validation and registration operation. The CLI and UI can check a repository path before registration. Both resolve the Git branch's configured upstream URL and branch; duplicate repository roots are rejected with the existing project path. `start` and `stop` resolve a unique project name or repository path, defaulting to the current directory when omitted; duplicate names require a path. Neither path can specify arbitrary shell text.

`leesh-loop stop --all` lists and stops active project Loops through the same per-project lifecycle API. It reports Loops with unconfirmed process ownership and leaves them untouched. It does not stop Manager Service. `leesh-loop manager stop` verifies the service record's PID and start identity and confirms the authenticated Manager endpoint before requesting shutdown; if either check is uncertain it does not signal a process. The Manager closes its Task Store connections on exit and leaves Loop processes running.

An instance's `project.toml` records its repository URL/base branch, workflow path, workspace root, Store state directory, and optional Codex/workspace-file settings. Internal Symphony ports are assigned from the user-configured Manager range, default `4100`–`4199`; the Manager UI defaults to port `4320`. The Manager probes the OS socket table for an available port and tracks active assignments. The per-project `ui_port`/`symphony_port` settings are not part of new instance configuration.

On start, the Manager selects the active immutable Runtime distribution, opens the instance configuration, validates its workspace files, assigns a port, and launches the existing `operator/app/leesh-loop.mjs start` path with manager-owned execution state. Symphony startup, Worker dispatch, Workspace behavior, task transitions, Codex app-server, approvals, and sandbox execution remain in the existing Loop runtime. The Manager uses only its process start/stop, ownership, readiness, and local runtime status contracts.

The Local Publisher remains the authority for Accepted Plan publication. The Manager routes task reads and allowed mutations by selected Instance ID to that instance's Local Task Store. A stopped Loop still has an available Store. Per-instance Store connections are independent and closed when the Manager exits.

## Runtime distributions and updates

The Runtime manifest selects shared execution code and its locked dependencies. Installation materializes a content-identified version in the Runtime directory, installs UI and Store npm dependencies, fetches and compiles the locked Symphony Mix dependencies, builds the UI, verifies the identity, and only then activates it. Failed staging leaves the previous active pointer in place. Installed versions are retained so a running process can continue using the Runtime directory it started from.

The source snapshot is explicit in `operator/app/runtime-manifest.mjs`. When adding a Runtime module, add its file or containing directory to `RUNTIME_SNAPSHOT_PATHS`; importing it from another module does not include it in the installed distribution.

`leesh-loop update` explicitly installs and activates the current source's Runtime and reloads an already-running Manager when its own Runtime version is behind. A Runtime update started in the Manager UI activates the version for new Loops and reports when the Manager needs that CLI reload. New Loop starts use the active distribution; running Loop processes keep their existing code and dependencies. Runtime updates are independent of Workflow updates. An instance Workflow can be compared with the latest template and explicitly replaced only while that instance is stopped. The previous file is saved under `workflow-backups/` before replacement.

Runtime or Manager upgrades do not migrate Task Store schemas or mutate active Workers. If a future Runtime requires an incompatible data change, compatibility must be established before that operation is enabled.

## Operator and Task contract

The Manager UI includes the existing Operator features. Each Task API request carries the selected Instance ID, and the server resolves it through its registry before opening a Store. The API preserves Accepted Plan publishing, Task list/detail, State, Blocked By, comments, Workpad, and Human Review meanings. UI drafts are keyed by instance so selection changes do not mix publication data.

The Local Task Store remains authoritative for State, immutable Accepted Plans, Blocked By relations, Workpad records, and comments. The Worker remains bound to its Local Task Store tooling. Manager availability is not a prerequisite for Task processing or Workpad writes.

## Verification and development

The Local Smoke Run under [`local-e2e/README.md`](../local-e2e/README.md) verifies the existing Symphony and controlled Worker behavior. Manager verification adds isolated XDG roots, two local Git repositories, real API/UI requests, OS process/socket observation, and direct Store readback. It does not infer actual Codex/external-service behavior from a controlled Worker.
