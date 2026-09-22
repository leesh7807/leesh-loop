# Leesh Loop

Leesh Loop is a local agent execution loop for a single software repository.

It publishes plans written as plain text or Markdown to a Notion task surface, then uses [OpenAI Symphony](https://github.com/openai/symphony) to execute runnable tasks with agents.

```text
Plan → Operator Publisher → Notion Tasks → Operator Symphony → Agent Work → State / Result
```

Leesh Loop does not live inside the target repository or wrap it.

Each repository has a separate loop directory dedicated to that repository.

```text
foo/
    source repository
    WORKFLOW.md
    ...

foo-loop/
    operator/
        app/
        notion_publisher/
        symphony/
        external/chatgpt-shot/
```

`foo-loop` accesses and operates `foo` from outside the repository.

A different repository uses a different loop.

```text
foo/       ← foo-loop
bar/       ← bar-loop
```

There is no separate central project manager for coordinating multiple repositories.

The root `WORKFLOW.md` in this repository is the concrete execution contract for Leesh Loop itself. It is not the generic workflow for every repository operated by a loop.

When a separate loop is created for another source repository, that repository needs a workflow adapted to its own runtime and repository rules. [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md) is the reusable starting point and reference for defining that repository-specific workflow.

## Operator readiness

The Operator owns project configuration, lifecycle state, readiness, Symphony startup, and the project browser workspace. Copy `operator/project.example.json` to `operator/project.json`, set absolute paths, and configure the Project's required Git target binding:

```json
{
  "github_repository_url": "https://github.com/owner/repository.git",
  "github_base_branch": "main"
}
```

`github_repository_url` and `github_base_branch` are always used together. `main` is only an example; it has no special meaning in the workflow. Existing configured base branches are used unchanged. If the configured base is missing, Operator readiness creates it from the configured repository's current default-branch HEAD and verifies the remote branch and commit before dispatch. Workspace creation, task branches, Rework, PRs, Merging, and Done verification then all use that same configured base branch.

Use the intended entry point:

```sh
node operator/app/leesh-loop.mjs start operator/project.json
```

The bundled development launcher uses `mise exec -- mix run`; install the pinned toolchain and
run `mise exec -- mix deps.get` from `operator/symphony` before the first start.

Before spawning Symphony, the bootstrap always validates the workspace, GitHub HTTPS network and
credential path, and the configured base branch bootstrap/readback. By default it then performs
external readiness: it verifies the installed `chatgpt-shot` configuration and browser/session
state, starts or recovers its Service, confirms the health endpoint is accepting requests, and
performs one real `chatgpt-shot submit` smoke submission before launching Symphony. Missing or
invalid readiness stops the command before any tracker task is dispatched; it never performs
interactive login.

An Operator Project may set `skip_external_readiness` to `true` when its execution environment
cannot access the Operator-owned state outside `$SYMPHONY_WORKSPACE_ROOT`. In that case only the
external readiness boundary is skipped: the bootstrap does not read or prepare `chatgpt-shot`
configuration, browser/session state, Service state, smoke Jobs, worker interface, or external
readiness evidence. Core startup and dispatch readiness still run through the same
`leesh-loop.mjs start` path. Omitted or `false` keeps the default external readiness behavior.

The ownership boundary is:

```text
Operator
├─ workspace-root placement
├─ GitHub credential readiness
├─ chatgpt-shot installation
├─ chatgpt-shot auth/session/browser lifecycle
├─ chatgpt-shot Service lifecycle
└─ external-service readiness validation

Worker
├─ repository work inside assigned workspace
├─ normal Git/GitHub operations
├─ chatgpt-shot submit "<prompt>"
└─ chatgpt-shot jobs <job-id>
```

The worker command is a restricted Service client prepared in an Operator-owned interface
directory. It supports only review Job submission and readback through `submit` and `jobs`; it
does not run `doctor`, `start`, login, browser recovery, profile repair, or access the
`chatgpt-shot` Notion credentials. The XDG configuration, data, cache, browser profile, Service
runtime state, and worker interface stay outside `$SYMPHONY_WORKSPACE_ROOT`.

## How It Works

The Publisher takes a plan written as plain text or Markdown, normalizes it into the canonical Leesh Loop task representation, and publishes it to Notion.

Notion task State remains lifecycle authority. Its canonical Workpad is the live
execution surface: workers reconstruct current execution context from the Workpad,
Accepted/Repository Plan, State, and actual workspace on every dispatch. The
Repository Plan remains the durable execution contract rather than a running log.

The Publisher owns publication state only: it creates incomplete tasks as `Publisher Pending` and
sets `State` to `Ready` after the canonical representation is complete and validated. The Notion
`State` is a Notion select property. New databases are seeded with the repository workflow's
state vocabulary plus `Backlog`; `Backlog` is a normal non-active, non-terminal waiting state
and is never dispatched. The publisher may additionally use its transient `Publisher Pending`
state while a task is being constructed.

Symphony starts observable but dispatch-disabled. Only after the Operator publishes durable `running` authorization and Symphony writes its dispatch acknowledgement can it find runnable tasks in Notion and run agents in isolated workspaces. Repeated `start` reuses only a compatible acknowledged running runtime; use `node operator/app/leesh-loop.mjs stop operator/project.json` before replacing a live incompatible runtime. Stopping never stops the external `chatgpt-shot` Service.

`operator/project.json` may include `workspace_files`, an optional array of absolute host-local regular-file paths. Each configured file is copied by basename to the root of a newly created workspace after the repository clone and before dependency bootstrap; for example `/home/user/leesh-loop/.env` becomes `<workspace>/.env`. Empty or omitted arrays preserve the usual behavior. Relative, missing, non-regular, and duplicate-basename sources reject Operator startup. Existing workspace destinations are never overwritten. The setting is part of runtime compatibility, but it is only applied for new workspaces: continuations preserve their existing files and do not apply a later configuration change.

Configured base bootstrap/readback always runs, and the normal readiness evidence records the
directly read-back `github_base_commit`. The same repository and branch values are passed to Symphony as
`SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH`; a missing value is a
configuration/readiness failure, not an invitation to infer `origin`, a default branch, or `main`.
When external readiness runs, its readiness record also includes the prepared `chatgpt-shot`
discovery path and worker interface.

After that readiness and dispatch-acknowledgement boundary, `start` opens the local Plan Publish surface, configured Notion database, and Symphony dashboard. On Linux the default path sends each URL to `xdg-open`, so the desktop uses its system default browser; Leesh Loop does not require `google-chrome`, `chromium`, or `chromium-browser` to exist. Browser, window, and tab placement are owned by the desktop environment. Set `LEESH_LOOP_BROWSER_COMMAND` to explicitly replace this default path; it receives the three project-surface URLs and does not fall back to `xdg-open` if it fails.

Agents work against the target repository according to its `WORKFLOW.md`, then write results and state back to Notion. For the concrete Leesh Loop workflow, a bound Symphony worker may also publish a supplied Plan as a canonical `Backlog` task through the existing Publisher and add that task to the current task's `Blocked By` relation. These are separate limited capabilities: the relation operation is bound to the dispatched task and is not arbitrary Notion management.

## Production E2E harness

The production E2E harness lives under [`operator/e2e`](operator/e2e). Run it with
`node operator/e2e/cli.mjs run operator/e2e/project.json` after configuring the normal Operator,
Notion, GitHub, and Codex credentials. The checked-in E2E project keeps its dedicated Notion
database binding and seed source ref, resolves the repository-owned E2E workflow, creates an opaque
run-scoped base and a nested run-local Symphony workspace inside the current checkout, and uses the
existing Publisher → `leesh-loop.mjs start` → Operator → Symphony production path. It does not
introduce a separate E2E runtime or Symphony launcher, and stores durable evidence under the ignored
`operator/e2e/runs/<run-id>/run.json` record. Use `--plan PATH [--hard-cap-ms MS]` for direct workload
input and `--workflow PATH` for an exact per-run workflow.

The harness records observed lifecycle, worker/review timing, external artifacts, finalization and
cleanup separately. A run that ends at an observed production failure or finite hard cap is still a
useful result when its evidence is preserved and admission reconciliation confirms that no residue
blocks the next run. `node operator/e2e/cli.mjs admit operator/e2e/project.json` performs the same
pre-dispatch safety check without publishing a task.

## Repository Harness

Leesh Loop assumes that the target repository already has a harness suitable for agent work. This follows from Symphony's model of running workers against the repository's existing development environment and rules.

Each source repository needs a `WORKFLOW.md` that defines how Symphony should carry out work in that repository. The root `WORKFLOW.md` is Leesh Loop's own concrete workflow. [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md) is the reusable reference and starting point for workflows used by other repositories.

## Publisher

The Publisher normalizes plan documents into the Notion execution surface.

```text
Plan
  ↓
Normalize
  ↓
Notion Tasks
```

It creates the shared canonical task representation: durable `Identifier`, `Title`, `State`,
`Priority`, `Labels`, and `Blocked By` metadata plus an explicit `Plan` relation. The task page
body is the mutable Workpad; the relation opens a separate locked Plan page containing the complete
accepted Plan. The Publisher and Notion adapter share this representation, and comments remain a
separate human-review surface.

`Human Review` is the single non-terminal human pause state. Workpad cycle markers
make ordinary review return, bounded comment consumption, and Rework recovery
understandable without adding a separate lifecycle database. `In Progress` resumes
the preserved workspace; `Rework` deliberately starts a fresh task branch from the
current remote configured base and preserves the latest Repository Plan. A human
approval moves the task to active `Merging`, where a worker merges only the PR and
exact HEAD delivered to that review cycle, verifies the result on the fetched remote
configured base, and only then moves the task to `Done`.

These are the Leesh Loop integration contracts: successful publication hands work to Symphony in
`Ready`; changing that handoff requires coordinated Publisher and workflow changes; and the
Publisher/adapter representation remains shared. Free-form `State` removes schema-option coupling
for ordinary workflow-state additions or renames, but it does not make the complete lifecycle
independently configurable.

## Symphony

Task execution uses [OpenAI Symphony](https://github.com/openai/symphony).

At a high level, Symphony polls the configured tracker for runnable work, manages isolated
workspaces, and runs agent workers against the repository.

Repository-specific worker behavior and the exact state vocabulary are defined by `WORKFLOW.md`.
Scheduling, dispatch, retry, reconciliation, workspace/session lifecycle, and active/terminal
state semantics are upstream Symphony behavior; see the [upstream Symphony specification](https://github.com/openai/symphony/blob/main/SPEC.md) for that detailed runtime contract.

## Browser UI

Each loop provides a local browser UI for viewing and managing the execution state of the repository it operates.

```text
foo-loop
    ↓
local browser UI
    ↓
tasks / runs / state
```

The UI is scoped to one repository and its loop.

## Example Workflow

This repository may include an example workflow showing how Leesh Loop can be used in a real development process.

The planned example uses [`chatgpt-shot`](https://github.com/leesh7807/chatgpt-shot) as an external utility for independent review.

A concrete workflow and execution example can be added once that structure is implemented.
