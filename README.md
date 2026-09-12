# Leesh Loop

Leesh Loop is a local agent execution loop for a single software repository.

It publishes plans written as plain text or Markdown to a Notion task surface, then uses [OpenAI Symphony](https://github.com/openai/symphony) to execute runnable tasks with agents.

```text
Plan
  ↓
Publisher
  ↓
Notion Tasks
  ↓
Symphony
  ↓
Agent Work
  ↓
State / Result
```

Leesh Loop does not live inside the target repository or wrap it.

Each repository has a separate loop directory dedicated to that repository.

```text
foo/
    source repository
    WORKFLOW.md
    ...

foo-loop/
    publisher
    Symphony
    runtime state
    browser UI
```

`foo-loop` accesses and operates `foo` from outside the repository.

A different repository uses a different loop.

```text
foo/       ← foo-loop
bar/       ← bar-loop
```

There is no separate central project manager for coordinating multiple repositories.

## How It Works

The Publisher takes a plan written as plain text or Markdown, normalizes it into the canonical Leesh Loop task representation, and publishes it to Notion.

Notion acts as the durable execution surface for tasks and workflow state.

The Publisher owns publication state only: it creates incomplete tasks as `Publisher Pending` and
sets `State` to `Ready` after the canonical representation is complete and validated. The Notion
`State` property stores provider-native strings as free-form rich text; the repository's workflow
state vocabulary remains in `WORKFLOW.md` and Symphony.

Symphony finds runnable tasks in Notion and runs agents in isolated workspaces.

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

Rather than copying plan content into free-form Notion pages, it creates the shared canonical task
representation: durable `Identifier`, `Title`, `Priority`, `Labels`, and `Blocked By` metadata,
plus exactly one direct `Plan` child page and one direct `Workpad` child page. The Publisher and
Notion adapter share this representation.

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
