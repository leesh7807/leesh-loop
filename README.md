# Leesh Loop

Leesh Loop runs an agent task loop for a single GitHub repository. Each Loop keeps its task data in a private SQLite Local Task Store beside the target repository, serves a local Operator page, and uses the same store for Symphony and Worker activity.

It runs on Linux or Unix. On Windows, use WSL2. Install Node.js 20.19+ or 22.12+ with npm, Git, GitHub CLI, mise, Codex CLI, and configure the `chatgpt-shot` review command on the machine that will run the Loop. You need access to the target GitHub repository. Task publishing and management do not require a Notion Task database or credentials.

## Create a Loop

Run `leesh-loop init` from the root of a Git repository with its upstream configured. Init creates a sibling Loop directory containing the runtime and a generated `WORKFLOW.md`; it does not modify the target repository.

```bash
cd /path/to/your-repository
leesh-loop init
cd ../your-repository-loop
npm start
```

The Operator page opens in your browser. If it does not open automatically, use the `Operator page` URL printed by `npm start` (the default is <http://127.0.0.1:4310>). The page shows the repository, Local task queue, Accepted Plan editor, and selected task details. The task database is created under `.runtime/state/local-task-store/local-task-store.sqlite` by default.

`npm start` prepares the Local Task Store and UI, checks core workspace/GitHub readiness, starts Symphony against the same SQLite file, and opens the Operator. `npm stop` stops the owned runtime and UI without deleting task data. Restarting the Loop or updating the runtime preserves Tasks, Accepted Plans, Blocked By relations, Workpad records, and comments.

## Publish and manage tasks

In the Operator, paste a complete Accepted Plan with an H1 and select its initial State and any Blocked By tasks. Publish it to create a Task and its immutable Accepted Plan together. The Publisher derives the Task title and identifier, and the UI reports the saved identity and opens its detail.

The queue puts Human Review tasks first, followed by active work. A task detail shows its Accepted Plan, Worker Workpad, comments, current State, and Blocked By tasks. Add review input as a comment, then choose the next State according to the generated `WORKFLOW.md`. State and Blocked By changes are explicit; comments do not start work or approve a change. Accepted Plans and Workpads are read-only in the UI.

For a normal user flow, use the Operator. A CLI publication command is also available for maintenance or scripts:

```bash
npm run publish-local-plan -- --plan /path/to/accepted-plan.md --state Ready
```

## Configuration and updates

The Loop root `project.toml` records the target repository/base branch, workflow path, workspace root, and runtime state directory. There is no task-store selector: a new Loop always uses its Local Task Store. Task operations need no Notion Task settings. `chatgpt-shot` is a separate external review service and keeps its own service configuration.

`leesh-loop update` updates the runtime and its npm package lock while preserving the generated workflow. `leesh-loop update --workflow` updates the generated `WORKFLOW.md` separately. Apply both when an update requires changes to both surfaces. Runtime updates preserve Project settings, environment files, task data, workspaces, and user-edited workflow files unless the workflow update is explicitly requested.

Project settings and boundaries are described in [System responsibilities and configuration](docs/SYSTEM.md). The visual design principles are in [Design principles](docs/DESIGN.md).

## Local Smoke Run

The isolated Local Smoke Run uses the actual Operator server and UI, Local Publisher, SQLite Store, Symphony, and a controlled Worker without an AI model or external Task database. Its data and processes are separate from user Loops.

```bash
# Automated publication, Store, Operator API, Symphony, Worker, and readback flow
npm run e2e

# Open on an empty Store, type s and Enter in the terminal to seed example Tasks,
# then type q and Enter to stop
npm run e2e -- --mode interactive
```

Interactive mode prints the local Operator URL while the Store is empty so the Plan screen can be evaluated. After `s`, it prepares three distinct Backlog Tasks and a Human Review scenario through the real Operator, Local Publisher, Symphony, and controlled Worker. The Backlog Tasks stay non-dispatchable. The process removes its temporary files and owned processes after `q`.

## Development checks

```bash
npm test
(cd operator/symphony && mise exec -- mix test)
npm run e2e
```

The Smoke Run README describes its isolated setup and interactive controls: [local-e2e/README.md](local-e2e/README.md).
