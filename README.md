# Local Agent Coordination

This repository organizes software work around three roles:

```text
PLAN.md     -> plan the work
WORKFLOW.md -> execute the work
REVIEW.md   -> review the result
```

The roles share the same task records.

```text
             Task Records
            /     |      \
           /      |       \
      Planner  Executor  Reviewer
                  |
               Symphony
                  |
            Isolated Workers
```

The task records show what work exists, what is ready, what is blocked, what changed, and what needs attention.

Each role reads and updates those records. It does not need the hidden context of another role.

## Task Records

A task record may contain:

```text
- identifier
- title
- state
- priority
- dependencies
- objective
- verification
- workpad
- comments
- result
```

The exact schema can change with the repository.

Write down anything another actor needs to continue the work. Do not leave important context inside one agent session.

The records may live in a tool such as Notion.

## Role Documents

Each role has its own instruction document.

### `PLAN.md`

Defines how work should be planned.

It should capture the objective, important decisions, user-provided constraints, accepted tradeoffs, and the evidence that will show whether the work is complete.

Plans should describe meaningful outcomes, not just implementation steps.

A planned unit should have one clear responsibility and a result that can be understood and checked on its own.

Do not split work only to make tasks smaller for an agent.

If a planned unit is hard to state as clear work, check whether its scope or domain boundary is understood well enough.

### `WORKFLOW.md`

Defines how assigned work should be executed.

The worker reads the task, inspects the repository, performs the work, verifies the result, and updates the task record.

Execution may use Symphony.

Symphony:

```text
Task A -> Workspace A -> Worker A
Task B -> Workspace B -> Worker B
Task C -> Workspace C -> Worker C
```

It finds runnable work, limits concurrency, creates isolated workspaces, starts workers, and reconciles their execution.

Symphony does not plan the work or review the result.

### `REVIEW.md`

Defines how completed work should be reviewed.

The reviewer reads the task, inspects the implementation, checks the evidence, and records the result.

The reviewer should not depend on the executor's hidden context.

If more work is needed, the review should leave clear feedback in the shared records.

## Runtime Configuration

Role documents may use front matter for runtime settings.

```text
---
model configuration
runtime configuration
external service configuration
---

role instructions
repository-specific rules
user preferences
verification expectations
```

Different roles may use different models or runtimes.

Planning and review may need only one agent. Execution may use Symphony to run several workers in parallel.

## Repository Artifacts

Not every record belongs in the task system.

Plans, specifications, validation artifacts, and other engineering documents may stay in the repository when they should be versioned with the code.

Use task records for coordination.

Use repository artifacts for engineering context that should live with the implementation.

They may reference each other when useful.

## How the Parts Connect

```text
Planner
   |
   v
Task Records
   |
   v
Symphony
   |
   v
Execution Agents
   |
   v
Task Records
   |
   v
Reviewer
   |
   v
Task Records
```

The planner does not need to know how Symphony runs workers.

The executor does not need to know who created the task.

The reviewer does not need to know how execution was scheduled.

They need the same records and clear role instructions.

## Design Direction

This repository does not define a universal development workflow.

It keeps repository-specific and user-specific working rules close to the code so that agents do not have to guess them.

The aim is to make it easier to:

* state intent;
* preserve important decisions;
* hand work between agents;
* run independent work in parallel;
* review results separately;
* continue work without hidden conversational context.

Agents can inspect code and evidence. They cannot know an unstated preference, intention, or accepted tradeoff.

Those must be written down.

## Symphony Runner

The implementation lives in [`symphony/`](symphony/). Its caller supplies the execution-input
`WORKFLOW.md`, explicitly or from the caller's current directory. Symphony runs on Unix/Linux; on
Windows, use WSL2. See [`symphony/README.md`](symphony/README.md) for runner setup and use.
