# Notion tracker adapter profile

`tracker.kind: notion` uses Notion API version `2025-09-03`. Its provider settings are
`database_url` and `token`; `token` may be `$ENV_NAME` and is resolved only in the Symphony host
(`NOTION_TOKEN` is the fallback). The worker process receives neither value.

```yaml
tracker:
  kind: notion
  provider:
    database_url: $NOTION_DATABASE_URL
    token: $NOTION_TOKEN
  active_states: [Ready, In Progress]
  terminal_states: [Done, Canceled]
```

The database URL identifies a database container. Symphony retrieves its child data sources and
chooses exactly one whose schema has `Identifier` (rich text or title), `Title` (title), `State`
(status or select), `Priority` (number or select), `Labels` (multi-select), and `Blocked By`
(relation). Zero or multiple compatible sources are configuration errors; a display name, view, or
enumeration order is never a tie breaker. The selected data source is the configured tracker scope.

Each task is normalized structurally: page ID becomes `Issue.id`, Identifier becomes
`Issue.identifier`, page URL/timestamps are copied, and unavailable Symphony-only fields are null
(`branch_name`, `assignee_id`, `native_ref`). Labels default to their property values and
`Blocked By` is read with property pagination. `dispatchable` is true only when every related
blocker has a represented state in `terminal_states`; unavailable blocker state is false.

The task must have exactly one direct child page named `Plan` and one named `Workpad`. Only Plan
blocks become `Issue.description`, and Plan must be non-empty. Headings in the task body, nested
pages, alternate names, ordering, comments, and free-form text are never compatibility fallbacks
or lifecycle input. A malformed task is logged and omitted from a state poll; a visible malformed
page makes ID refresh fail. Missing or out-of-scope IDs are omitted. Observed duplicate Identifiers
fail the read rather than being repaired.

All query, child-block, relation-property, and comment reads follow provider pagination. State
polls query the resolved data source; ID refresh additionally proves the page parent is that data
source, so accessible pages elsewhere are outside scope.

Bound Notion sessions advertise only `notion_task_read`, `notion_task_comments`,
`notion_task_set_state` (`state` string), and `notion_task_append_workpad` (`text` string). The
host checks the bound page and data-source identity before each call. State is the only mutable
property; Workpad only accepts appended paragraphs. No schema, database, identity, Plan, or generic
page mutation capability is exposed. Session binding retains adapter, settings, credential
resolution, data-source ID, issue ID, and tool specs across `WORKFLOW.md` reload; reload affects
future tracker operations and sessions only.

Errors are stable atoms grouped as invalid configuration, authentication/provider response,
transport, rate-limit, malformed response/pagination, malformed representation, and tracker
identity-invariant failures.
