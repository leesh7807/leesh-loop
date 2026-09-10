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

The Publisher takes a plan written as plain text or Markdown, normalizes it into the Leesh Loop task model, and publishes it to Notion.

Notion acts as the durable execution surface for tasks and workflow state.

Because the Publisher maps plans into a defined task structure and state vocabulary, it is more than a document copy tool. It turns a plan into the execution surface used by the rest of the loop.

Symphony finds runnable tasks in Notion and runs agents in isolated workspaces.

Agents work against the target repository according to its `WORKFLOW.md`, then write results and state back to Notion.

## Repository Harness

Leesh Loop assumes that the target repository already has a harness suitable for agent work. This follows from Symphony's model of running workers against the repository's existing development environment and rules.

`WORKFLOW.md` is the execution contract that tells Symphony how work should be carried out in that repository.

## Publisher

The Publisher normalizes plan documents into the Notion execution surface.

The loop's `WORKFLOW.md` selects that surface through `tracker.kind: notion`
and `tracker.provider.database_url`. Publisher and Symphony consume this same
resolved setting: there is no separate Publisher database target.

```text
Plan
  ↓
Normalize
  ↓
Notion Tasks
```

Rather than copying plan content into free-form Notion pages, it creates or updates records according to the task schema, relations, and state vocabulary used by Leesh Loop.

## Symphony

Task execution uses OpenAI Symphony.

Symphony finds runnable work from Notion task state, creates an isolated workspace for each task, and starts an agent worker.

Repository-specific worker behavior is defined by `WORKFLOW.md`.

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
