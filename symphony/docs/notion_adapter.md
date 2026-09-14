# Notion tracker adapter profile

`tracker.kind: notion` uses Notion API version `2025-09-03`. Its provider
settings are `database_url` and `token`; `token` may be `$ENV_NAME` and is
resolved only in the Symphony host (`NOTION_TOKEN` is the fallback). The worker
process receives neither value.

```yaml
tracker:
  kind: notion
  provider:
    database_url: $NOTION_DATABASE_URL
    token: $NOTION_TOKEN
  active_states: [Ready, In Progress, Rework]
  terminal_states: [Done, Cancelled]
```

The configured URL identifies a database container. The adapter retrieves all
child data-source schemas and structurally selects exactly one task data source
whose schema contains `Identifier`, `Title`, `State`, `Priority`, `Labels`,
self-relation `Blocked By`, and relation `Plan`. The `Plan` relation's schema
target is the expected Plan data source. That target must contain the dedicated
Plan identity schema: `Identifier` and `Title`, without task lifecycle or
Symphony-only properties. Zero, multiple, malformed, or ambiguous sources are
configuration errors; display names and enumeration order are never tie
breakers.

Each task is normalized structurally. Page ID becomes `Issue.id`, Identifier
becomes `Issue.identifier`, page URL/timestamps are copied, and numeric
Priority is rounded to Symphony's portable integer priority. Unavailable
Symphony-only fields are null (`branch_name`, `assignee_id`, `native_ref`).
Labels default to their property values and `Blocked By` is read with property
pagination. `dispatchable` is true only when every related blocker has a
represented state in `terminal_states`; unavailable blocker state is false.

The adapter resolves the Plan only through the task's `Plan` relation. The
relation must contain exactly one page. The related page must belong to the Plan
data source and its `Identifier` must equal the task Identifier. Only the
related Plan page's direct paragraph blocks become `Issue.description`, and the
content must be non-empty. Task body blocks are the mutable Workpad and are
ignored; headings, child-page names, nested pages, ordering, comments, links,
and arbitrary text are never Plan fallbacks. A malformed task is logged and
omitted from a state poll; a visible malformed page makes ID refresh fail.

All query, Plan-block, relation-property, blocker, and comment reads follow
provider pagination. State polls query the resolved task data source; ID refresh
also proves the page parent is that data source, so accessible pages elsewhere
are outside scope. Observed duplicate Identifiers fail the read rather than
being repaired.

Bound Notion sessions advertise only `notion_task_read`,
`notion_task_comments`, `notion_task_set_state` (`state` string), and
`notion_task_append_workpad` (`text` string). The host checks the bound page and
task data-source identity before each call. Workpad append sends a paragraph
directly to `/blocks/<task-page-id>/children`; it does not look up or create a
child page. Comments remain reads against the task page's comments endpoint and
retain their own pagination. No schema, identity, Plan, or generic page
mutation capability is exposed.
