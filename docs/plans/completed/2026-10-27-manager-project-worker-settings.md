# 2026-10-27-manager-project-worker-settings

## Objective

Allow users to inspect, change, and clear a project’s existing Codex model and reasoning-effort overrides through the Manager UI and CLI, with changes safely persisted to that Loop Instance and used by a later Loop start.

## Intent

Each Manager-managed Loop Instance has a private, separate project.toml. It can hold optional codex_model and codex_reasoning_effort values that affect the Codex Worker started for that project. Users currently have no Manager UI or project-aware CLI operation for these settings, so changing them requires editing a Manager-owned file directly.

This follow-up adds a small project-scoped settings capability. It does not make project.toml generally editable and does not change the Worker, Symphony, or Codex execution contract.

## Verification Requirements

### VR-1. Project-scoped setting management

- The Manager UI must show the current codex_model and codex_reasoning_effort values for the selected project, with the project name and repository path visible.
- Users can set or clear either optional override independently. Clearing a value restores the omitted-setting behavior already defined by project configuration.
- The CLI can inspect, set, and clear the same settings using a unique project name, repository path, or current-directory context. Ambiguous project names must fail with enough information to select the intended repository.
- UI and CLI use the same Manager-owned project configuration operations, validation, persistence, errors, and lifecycle meaning. Neither path requires an internal Instance UUID for ordinary use.
- Values displayed after a write match authoritative per-instance project.toml readback; other Loop Instances remain unchanged.

### VR-2. Safe persistence and execution effects

- Updates modify only codex_model and codex_reasoning_effort, preserve every other setting and the Git repository, Task Store, Workflow, and workspace data.
- Empty, malformed, unsupported-type, or otherwise invalid updates fail with a useful reason and do not partially persist.
- A settings change never alters a running Loop or Worker. It is applied by a later Loop start. The UI and CLI explain this timing.
- A write is refused unless Manager confirms the Loop is Stopped or Failed with no active process. Running, Starting, Stopping, or Unconfirmed process states must be left untouched and the user receives a clear next step.
- The UI uses existing Manager authentication and same-origin protections. The API accepts only named setting values; it does not add arbitrary file, shell, Worker, or Runtime capabilities.

### VR-3. Actual setting effect and independent reviewability

- Through the intended Manager UI or CLI path, configure one override, start that project through the normal Manager lifecycle, and verify that the real Worker starts with the selected setting through the normal Symphony → Codex path.
- Verify omission and clear behavior for each field without changing the other field.
- Retain direct browser screenshots of the selected-project settings view and saved values, representative CLI output, and sanitized authoritative configuration/Worker readback under docs/ui-evidence/2026-10-27-manager-project-worker-settings/. Identify the captured code HEAD and Runtime; do not use synthetic UI images.
- Record direct observation, test verification, inference, and any limits separately.

## Definitions

- **Project:** A user-selected Git repository managed by Manager.
- **Loop Instance:** The independently configured Manager record for a Project, with its own project.toml, Workflow, Task Store, workspace, and process.
- **Override:** A non-empty optional project.toml value that takes precedence over Codex defaults for a new Worker.
- **Clear:** Omit an optional override from project.toml, restoring the existing Codex default behavior.

## Decisions

1. Support only codex_model and codex_reasoning_effort. Do not add a general project.toml editor or expose internal paths and lifecycle identifiers as settings.
2. Preserve each field’s existing optional semantics. Do not add an allowlist of model names or reasoning-effort values; keep existing Codex validation boundaries.
3. UI and CLI call the same authenticated Manager configuration operation. Manager remains the authority for project targeting, process status, validation, and persistence.
4. Apply writes only when the selected Loop is confirmed Stopped or Failed without an active process. The next normal Loop start consumes the saved values.
5. Preserve independent Loop Process, Task Store, Workflow, Runtime, and Worker execution responsibilities.

## Planned Units

### Unit 1 — Project Worker settings

**Responsibility:** Inspect and change the two existing optional Worker overrides from project context in Manager UI and CLI.

**Outcome:** Users can safely set or clear the selected Project’s model and reasoning settings with consistent meaning across interfaces.

## Verification

### V-1. UI and CLI agreement (VR-1)

From the actual Manager UI, inspect a selected project, set model and reasoning values independently, clear one, and confirm the selected project identity and saved values remain clear. Use the CLI to read and change those same values by unique project name/path and current directory. Attempt an ambiguous same-name lookup and confirm it does not mutate either project.

**Pass:** UI, CLI, Manager response and per-instance project.toml agree, and same-name projects are never chosen implicitly.

### V-2. Persistence and lifecycle protection (VR-2)

Use an isolated XDG profile with two Git repositories and verify the project-specific file changes atomically while other settings, both other-instance data and task/workflow files remain unchanged. Attempt updates while Running and Unconfirmed and read back the unchanged file and process identities.

**Pass:** Only the targeted optional fields change; unsafe lifecycle states reject writes without signaling or changing processes.

### V-3. Real Worker effect and evidence (VR-3)

Use the actual Manager UI or CLI setting path, start the Loop through Manager, and observe a real Codex Worker launch with the configured model or reasoning option through the existing runtime path. Confirm a cleared option produces no corresponding override. Capture the actual browser view and CLI/config/process readbacks, with exact source HEAD and Runtime in the evidence README.

**Pass:** The configured value is observed at the real Worker launch boundary, omitted fields remain omitted, and evidence allows independent review without exposing credentials.

## Verification Tools

| Tool / Mechanism | Verification responsibility |
|---|---|
| Actual Manager browser UI | Project scope, values, save/error state, keyboard access and responsive layout |
| leesh-loop CLI | Name/path/current-directory targeting, setting reads/writes, ambiguity and lifecycle messages |
| Authenticated Manager API | Shared UI/CLI authority, validation, lifecycle guards and authoritative responses |
| Isolated XDG profile and two Git repositories | Per-instance isolation, project.toml persistence and unchanged repositories/data |
| OS process identity and real Codex Worker | Confirm stopped-state protections and actual setting effect on a new Loop |
| SQLite and filesystem readback | Verify task/workflow/workspace isolation and no unintended mutation |
| Browser captures and sanitized JSON/CLI records | Direct, reviewable evidence tied to the final source HEAD and Runtime |
