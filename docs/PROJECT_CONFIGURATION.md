# Operator Project configuration

Copy `operator/project.example.json` to `operator/project.json` and set the required absolute paths,
Notion database, and Git target for the Project. The example shows sample Codex override selections;
remove either or both fields when the Project should use Codex's own model or reasoning setting.

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
