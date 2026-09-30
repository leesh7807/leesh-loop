# Operator Project configuration

The checked-in `operator/project.json` configures this repository. Local paths may be absolute,
relative to the Project file, or start with `~` for the current user's home directory. Operator reads
`LEESH_LOOP_NOTION_DATABASE_URL` from its process environment or repository-root `.env`; it does not
read a database URL from Project JSON. This repository's Project sets the Git target with
`github_repository_url` and `github_base_branch`; Operator uses those values together.

The optional `workspace_files` list uses the same path rules. A configured file is copied by basename
to each newly created Symphony workspace. In particular, `../.env` refers to the repository-root
`.env` when the Project file is under `operator/`; the file contents are copied into new worker
workspaces. The repository `.gitignore` excludes `.env` and `.env.*`, except `.env.example`.

Projects may set either or both of these optional values:

```json
{
  "codex_model": "gpt-6-luna",
  "codex_reasoning_effort": "xhigh"
}
```

Each supplied value must be a non-empty string. Operator forwards only supplied values to the
Symphony process, and `WORKFLOW.md` passes only those settings as Codex `--config` arguments. When a
field is omitted, no corresponding override is added. Codex decides that setting from its own
configuration. Operator does not maintain a model or reasoning-effort allowlist; Codex validates the
value when it starts.

These settings are part of the live runtime configuration. Changing a value or adding/removing one
while a compatible runtime is running makes that runtime incompatible; stop it explicitly before
starting with the new Project configuration.

The independent E2E harness has no user-managed Project. It reads the production Project as authority
for `github_repository_url`, `github_base_branch`, `codex_model`, and
`codex_reasoning_effort`; it builds a run-local Operator Project using only those shared settings and
E2E-owned sandbox paths, temporary ports, workflow, state, and readiness policy. Production
`workspace_files`, workspace root, state directory, and fixed ports are not inherited.
