# System responsibilities and configuration

This document is for operators and maintainers who need the system boundaries behind the user steps in the [README](../README.md). Use the README for normal setup and task work.

## Runtime responsibilities

A Loop instance operates one target Git repository. It has a Project configuration in `operator/project.json`, a root `WORKFLOW.md`, a local Operator page, and isolated worker workspaces. The target repository remains separate from the Loop instance.

- **Operator** reads Project settings, checks startup requirements, starts the task runtime, and serves the local task and Plan page.
- **Publisher** writes a Plan and task to Notion using the configured database and publication State.
- **Symphony** dispatches eligible tasks and creates isolated workspaces from the configured Git base branch.
- **Worker** reads the generated Loop's root `WORKFLOW.md`, performs the task, and records task progress through the Notion task surface.

Notion State is lifecycle authority. The task page body is the mutable Workpad. Its related Accepted Plan is stored in a separate Plan page. The Repository Plan in the worker's workspace is the durable execution contract. A worker does not rewrite the Accepted Plan.

## Init and workflow source

Run `leesh-loop init` at the root of a target Git repository. Init reads the current branch's configured upstream URL and branch, creates a sibling Loop directory, and materializes a runtime snapshot that runs independently of the source checkout.

Init builds the generated root `WORKFLOW.md` from:

1. Runtime settings added at the beginning of the file, including the Notion tracker, workspace root, and Git clone hook.
2. The complete body of this repository's `docs/WORKFLOW_TEMPLATE.md`.

The generated `operator/project.json` sets `workflow_path` to `../WORKFLOW.md`, resolved relative to the `operator` directory. Symphony therefore reads the generated root file at task execution time. The template is a source for that agent contract, not a separate file the generated worker reads.

The source repository's root `WORKFLOW.md` is its own concrete agent contract. It is not copied to target repositories.

## Project settings and credentials

Project paths are resolved relative to `operator/project.json`; absolute paths and `~` are also supported. The core settings are:

| Setting | Responsibility |
| --- | --- |
| `github_repository_url` | Target GitHub repository. |
| `github_base_branch` | Target repository's base branch. Set it with the URL; Operator does not guess a branch. |
| `workflow_path` | Agent execution contract passed to Symphony. Init points this to the generated root `WORKFLOW.md`. |
| `symphony_workspace_root` | Parent directory for task workspaces. |
| `workspace_files` | Optional regular files copied by basename to newly created workspaces. Paths may be absolute, relative to `operator/project.json`, or start with `~`. Existing destinations are preserved. |
| `codex_model`, `codex_reasoning_effort` | Optional independent Codex overrides. Omitted values use Codex settings. |
| `open_project_surfaces` | Whether starting the Loop asks the desktop to open the Operator page. |
| `skip_external_readiness` | Operator-only setting that skips external review readiness; it does not skip core startup checks. |

### Git target

Configure the target repository URL and base branch together in `operator/project.json`:

```json
{
  "github_repository_url": "https://github.com/example/project.git",
  "github_base_branch": "main"
}
```

`main` is only an example. The configured base branch is used for task workspaces and branches, and as the target for delivery pull requests.

The Notion database URL comes from `LEESH_LOOP_NOTION_DATABASE_URL`; the integration token comes from `NOTION_TOKEN`. Operator reads either value from the process environment or the Loop root `.env`. Init does not create a Notion database, copy credentials, or save process-only values.

Treat `workspace_files` carefully: each configured file is copied into new worker workspaces. Do not use it for credentials or files that workers do not need. Continuations keep their existing workspace files.

### Changing settings while the Loop is running

An acknowledged task runtime records the effective settings that define its identity: `github_repository_url`, `github_base_branch`, `workflow_path`, `LEESH_LOOP_NOTION_DATABASE_URL`, `symphony_workspace_root`, `allow_workspace_root_inside_repository`, `workspace_files`, `codex_model`, `codex_reasoning_effort`, `skip_external_readiness`, `worker_interface_identity`, `symphony_command`, and `symphony_port`. Changing one while that runtime is running does not replace it. `npm start` reports that the Loop is running with different settings; run `npm stop`, then `npm start` to use the updated configuration. This also applies when changing either Codex override.

## Notion publication contract

The Publisher writes a task to the task data source and its complete Accepted Plan to a related Plan data source.

On first publication, the Publisher can initialize an empty Notion database. A populated database must already use the canonical Leesh Loop task and Plan schema; unsupported or ambiguous schemas are rejected.

- The task has `Identifier`, `Title`, `State`, `Priority`, `Labels`, a self-relation named `Blocked By`, and a `Plan` relation.
- The Plan has `Identifier` and `Title`. The task and Plan share the publication identifier; the relation selects the Plan page.
- The task page body is the Workpad. The complete Accepted Plan is written to the separate Plan page and that page is locked after validation.
- Comments remain a separate human review input. They are not merged into the Workpad or Accepted Plan.

Publication is recoverable while the task is in the temporary `Publisher Pending` State. Once the Plan and task representation are complete and validated, the Publisher applies the selected State. Its default is `Ready`; an agent publishing a follow-up Plan can select `Backlog`. A completed publication is not rewritten by a retry.

## Startup and workspaces

On start, Operator checks the Notion connection, workspace, GitHub access, and configured base branch. In the default setup it also checks the review command and its external readiness. A failed check prevents task dispatch and reports the item that needs attention.

The worker workspace is cloned from the configured base. Task branches, Rework, pull requests, and merge verification use that configured base; the remote default branch is not a substitute. Workspace files and review credentials stay within their separate ownership boundaries.

Repository E2E verification has its own guide and runtime under [`e2e/README.md`](../e2e/README.md). It is not part of the normal `npm start` user flow.
