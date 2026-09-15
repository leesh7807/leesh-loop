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

## Operator readiness

The Operator owns project configuration, lifecycle state, readiness, Symphony startup, and the project browser window. Copy `operator/project.example.json` to `operator/project.json`, set absolute paths, then use the intended entry point:

```sh
node operator/app/leesh-loop.mjs start operator/project.json
```

The bundled development launcher uses `mise exec -- mix run`; install the pinned toolchain and
run `mise exec -- mix deps.get` from `operator/symphony` before the first start.

Before spawning Symphony, the bootstrap validates the GitHub HTTPS network and credential path, verifies the installed
`chatgpt-shot` configuration and browser/session state, starts or recovers its Service, confirms
the health endpoint is accepting requests, and completes one real `chatgpt-shot submit` smoke
round trip before launching Symphony. Missing or invalid readiness stops the command before any
tracker task is dispatched; it never performs interactive login.

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
└─ chatgpt-shot submit "<prompt>"
```

The worker command is a submit-only Service client prepared in an Operator-owned interface
directory. It reads only the Operator's Service discovery record and invokes the already-running
Service; it does not run `doctor`, `start`, login, browser recovery, profile repair, or access the
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
`State` property stores provider-native strings as free-form rich text; the repository's workflow
state vocabulary remains in `WORKFLOW.md` and Symphony.

Symphony starts observable but dispatch-disabled. Only after the Operator publishes durable `running` authorization and Symphony writes its dispatch acknowledgement can it find runnable tasks in Notion and run agents in isolated workspaces. Repeated `start` reuses only a compatible acknowledged running runtime; use `node operator/app/leesh-loop.mjs stop operator/project.json` before replacing a live incompatible runtime. Stopping never stops the external `chatgpt-shot` Service.

Agents work against the target repository according to its `WORKFLOW.md`, then write results and state back to Notion.

## Repository Harness

Leesh Loop assumes that the target repository already has a harness suitable for agent work. This follows from Symphony's model of running workers against the repository's existing development environment and rules.

`WORKFLOW.md` is the execution contract that tells Symphony how work should be carried out in that repository. This repository's concrete contract is paired with the reusable [workflow template](docs/WORKFLOW_TEMPLATE.md): the template sets only Plan-based worker policy, while the root workflow supplies runtime setup, state handoff, and independent-review rules.

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
current `origin/main` and preserves the latest Repository Plan.

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
