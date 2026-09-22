# Notion plan publisher

The publisher core receives complete Plan content, an explicit Notion database
URL, a Notion client, resolved policy, and an optional fallback title:

```ts
publish({ plan, databaseUrl, fallbackTitle, client, config })
```

The URL identifies a Notion database container. The publisher reads every child
data-source schema and structurally resolves one task data source. It ensures a
sibling Plan data source exists under the same container, then ensures that the
task data source's `Plan` relation targets that Plan data source. Display names
and enumeration order are not identity boundaries; ambiguous task or Plan
sources fail.

The task data source contains the durable task properties:

- `Identifier`
- `Title`
- `State`
- `Priority`
- `Labels`
- self-relation `Blocked By`
- relation `Plan` to the Plan data source

The Plan data source contains only the accepted snapshot identity fields
`Identifier` and `Title`. A Plan page and its task share the same publication
`Identifier`. The relation selects the Plan page; equal identifiers prove that
the selected page belongs to the same publication.

The task page body is the Workpad. It starts empty and is never included in
`Tracker.Issue.description`. The complete accepted Plan is written only to the
separate Plan page body. After the Plan is completely written and validated,
the publisher locks that page with the Notion page-lock API. No worker or
adapter path mutates Plan content.

Publication is recoverable through `Publisher Pending`:

1. create or recover the pending task by its derived Identifier;
2. create or recover one matching Plan page in the Plan data source;
3. complete missing Plan content while publication is pending;
4. lock and validate the Plan page;
5. set the task `Plan` relation to exactly that page;
6. validate task/Plan source ownership, equal Identifiers, and complete content;
7. finalize the task to the selected publication State (the normal Publisher
   default is `Ready`; the worker publication capability selects `Backlog`).

Retries reuse a matching Plan page. Multiple task or Plan identities, an
existing pending relation to another publication, incomplete or conflicting
Plan content, and malformed schemas fail. A completed publication is a
duplicate and is never repaired or rewritten. The publisher creates no
`Plan` or `Workpad` child page.

The CLI is a convenience caller:

```sh
cd operator/notion_publisher && npm install && npm run build
node dist/src/cli.js \
  --plan /path/to/plan.md \
  --config /path/to/publisher-config.json \
  --database-url https://www.notion.so/Tasks-3d28a26586258052b3ecccc9c33787e3
```

Comments remain Notion comments attached to the task page. They are a separate
human-review input surface and are not merged into Workpad, Plan, or
`Tracker.Issue.description`.
