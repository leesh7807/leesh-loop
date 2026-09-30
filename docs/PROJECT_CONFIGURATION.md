# Operator Project configuration

The checked-in `operator/project.json` configures this repository. Local paths may be absolute,
relative to the Project file, or start with `~` for the current user's home directory. Operator reads
`LEESH_LOOP_NOTION_DATABASE_URL` from its process environment or repository-root `.env`; it does not
read a database URL from Project JSON. This repository's Project sets the Git target with
`github_repository_url` and `github_base_branch`; Operator uses those values together.

### `workspace_files`

Operator resolves each configured host-file path to an absolute path, then copies the file by
basename into the root of each newly created workspace. If the destination already exists, the copy
fails without overwriting it. Continuations preserve their current workspace and do not copy the
files again.

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

The Production E2E Project accepts the same optional fields. Each run copies configured fields to
its run-local Operator Project and leaves omitted fields absent.
