# System responsibilities and configuration

This document is for operators and maintainers who need the system boundaries behind the user steps in the [README](../README.md). Use the README for normal setup and task work.

## Runtime responsibilities

A Loop instance operates one target Git repository. Its Project configuration is the root `project.toml`; it also has a root `WORKFLOW.md`, a Local Operator page, and isolated worker workspaces. `operator/` contains the runtime that reads the Project. The target repository remains separate from the Loop instance.

- **Operator** reads Project settings, checks startup requirements, starts Symphony, and serves the Local Task UI.
- **Local Publisher** writes a Plan and task to the Loop's Local Task Store using the requested publication State.
- **Local Task Store** is the authoritative SQLite store for task properties, Accepted Plans, Blocked By relations, Workpad records, and comments.
- **Symphony** reads that same store to dispatch eligible tasks and creates isolated workspaces from the configured Git base branch.
- **Worker** reads the generated Loop's root `WORKFLOW.md`, performs the task, and records progress through the bound Local task tools.

Local Task State is lifecycle authority. The Workpad is mutable execution context, comments are human review input, and the Accepted Plan is immutable input. The Repository Plan in the worker's workspace is the durable execution contract. A worker does not rewrite the Accepted Plan.

## Init and workflow source

Run `leesh-loop init` at the root of a target Git repository. Init reads the current branch's configured upstream URL and branch, creates a sibling Loop directory, and materializes a runtime snapshot that runs independently of the source checkout.

The linked `leesh-loop` CLI maintains a per-user discovery registry for independent Loops. `leesh-loop list` reads the current state from each Loop's own runtime files and ownership checks; `leesh-loop start <instance>` and `leesh-loop stop <instance>` invoke that Loop's existing `npm start` and `npm stop` commands. The registry does not own or terminate processes. New Loops register at init, and successful runtime or workflow updates enroll existing Loops.

Init builds the generated root `WORKFLOW.md` from:

1. Local Task Store, workspace, and Git clone settings.
2. The complete body of this repository's `docs/WORKFLOW_TEMPLATE.md`.

The generated root `project.toml` sets `workflow_path` to `WORKFLOW.md`. Project-relative paths are resolved from the directory containing that TOML file, so Symphony reads the generated root workflow at task execution time. The template is a source for that agent contract, not a separate file the generated worker reads.

The source repository's root `WORKFLOW.md` is its own concrete agent contract. It is not copied to target repositories.

## Updating a generated Loop

Run `leesh-loop update` from the generated Loop root to replace its Leesh Loop runtime and npm package lock from the distribution that provides the CLI. `leesh-loop update --workflow` independently replaces only the generated root `WORKFLOW.md`. Runtime updates preserve the generated workflow; workflow updates leave runtime and npm files alone. Both preserve `project.toml`, environment files, workspace, and state. Updates do not operate on the target repository and should be run while the Loop is stopped.

## Project settings and credentials

Project paths are resolved relative to the directory containing root `project.toml`; absolute paths and `~/...` are also supported. The checked-in TOML and each generated Loop TOML document defaults and show optional settings as comments. UI and Symphony ports default to 4310 and 4100; set `ui_port` or `symphony_port` in `project.toml` when another local process uses a default. The core settings are:

| Setting | Responsibility |
| --- | --- |
| `github_repository_url` | Target GitHub repository. |
| `github_base_branch` | Target repository's base branch. Set it with the URL; Operator does not guess a branch. |
| `workflow_path` | Agent execution contract passed to Symphony. Init points this to the generated root `WORKFLOW.md`. |
| `symphony_workspace_root` | Parent directory for task workspaces. |
| `state_directory` | Optional Operator runtime state and Local Task Store directory. |
| `workspace_files` | Optional regular files copied to the new worker workspace root under their basename. Paths may be absolute, relative to `project.toml`, or start with `~/`. Git tracking status does not matter. Directories and globs are unsupported; duplicate basenames are rejected. Existing destinations are left untouched, and continuations do not recopy files. |
| `codex_model`, `codex_reasoning_effort` | Optional independent Codex overrides. Omitted values use Codex settings. |
| `open_project_surfaces` | Whether starting the Loop asks the desktop to open the Operator page. |
| `skip_external_readiness` | Optional setting that skips external review readiness; it does not skip core startup checks. |
| `startup_timeout_ms`, `browser_acknowledgement_timeout_ms` | Optional startup and browser acknowledgement timeouts. |

Task operations do not require a Task database URL, Task integration token, or Notion configuration. The Local Task Store is created under `state_directory/local-task-store/local-task-store.sqlite` and is preserved across normal shutdown, restart, and supported runtime updates. chatgpt-shot remains an external review service and owns its own configuration and internal service data; the Loop does not read or manage those details as Task storage.

The Local Publisher accepts the complete Accepted Plan, derives the Task title from its H1, and atomically stores the Task and immutable Plan. The Operator calls that Publisher boundary for user publication and uses Local Task Store operations for task reads, State, Blocked By, and comments. It does not write directly to the SQLite schema or impose a State-transition policy.

Use `workspace_files` only for regular files workers need. It is not a general credential transfer mechanism. A Git-ignored local file in the sibling target repository can be listed explicitly. The Operator validates the sources before starting and copies each file without recreating its source directories.

### Changing settings while the Loop is running

An acknowledged task runtime records the effective settings that define its identity: `github_repository_url`, `github_base_branch`, `workflow_path`, `symphony_workspace_root`, `allow_workspace_root_inside_repository`, `workspace_files`, `codex_model`, `codex_reasoning_effort`, `skip_external_readiness`, `worker_interface_identity`, `symphony_command`, and `symphony_port`. Changing one while that runtime is running does not replace it. `npm start` reports that the Loop is running with different settings; run `npm stop`, then `npm start` to use the updated configuration. This also applies when changing either Codex override.

## Startup and workspaces

On start, Operator initializes or opens the Local Task Store, checks the workspace and GitHub access, prepares the UI, and starts Symphony with the same Store path. In the default setup it also checks the review command and its external readiness. A failed core check prevents task dispatch and reports the item that needs attention.

The worker workspace is cloned from the configured base. Task branches, Rework, pull requests, and merge verification use that configured base; the remote default branch is not a substitute. Workspace files and review credentials stay within their separate ownership boundaries.

The isolated Local Smoke Run under [`local-e2e/README.md`](../local-e2e/README.md) provides automatic verification and an interactive Operator session with a controlled Worker. It is separate from the normal `npm start` user flow.
