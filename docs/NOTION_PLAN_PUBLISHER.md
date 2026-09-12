# Notion plan publisher

The publisher core is an in-process capability. It receives the complete UTF-8 Plan content, a resolved Notion database URL, a Notion client, resolved publication policy, and (when the Plan has no Markdown H1) a caller-resolved fallback title:

```ts
publish({ plan, databaseUrl, fallbackTitle, client, config })
```

The core owns Notion publication semantics: identifier and title derivation, schema validation, duplicate detection, incomplete-publication repair, child-page creation, and finalization. A heading-less Plan must supply `fallbackTitle`; this preserves a meaningful title without making a path part of the core contract. It does not accept paths or discover a destination through `.env`, `process.env`, `WORKFLOW.md`, Symphony, or the Notion adapter.

Authority and input acquisition belong to the caller. The upper operator owns the authoritative project-level Notion database binding and may separately materialize the matching Symphony tracker binding in `WORKFLOW.md`. Keeping those values synchronized is an operator/bootstrap responsibility, not a publisher responsibility.

For a given `(database destination, Plan content)` pair, concurrent calls must be serialized by the operator across processes or hosts. Notion has no unique constraint or transaction spanning publication lookup and task creation. The core serializes concurrent calls within one process; it does not provide a distributed lock. Duplicate detection is deterministic only within this single-writer boundary.

The CLI is one convenience caller. It reads a file and configuration, resolves the runtime credential, derives a filename fallback title only for heading-less Plans, then forwards those semantic values and the explicit destination to the same core:

```sh
cd notion_publisher && npm install && npm run build
node dist/src/cli.js \
  --plan /path/to/plan.md \
  --config /path/to/publisher-config.json \
  --database-url https://www.notion.so/Tasks-3d28a26586258052b3ecccc9c33787e3
```

`--plan`, `--config`, and `--database-url` are explicit CLI inputs. The database URL is not read from `NOTION_PUBLISH_DATABASE_URL`; defining that environment variable cannot override the value supplied to the publisher. The CLI may load `NOTION_TOKEN` from the process environment or a local `.env` in its current directory as a runtime-secret convenience.

Optional policy settings in the JSON configuration are `priority` (default `3`, or `null`),
`labels` (default `[]`), and `property_names` for the six canonical property names. The Publisher
owns only the publication states `Publisher Pending` and `Ready`; it does not accept a workflow
state or enumerate the repository's workflow vocabulary. Unknown keys and invalid structural types
fail before mutation.

The configured database is resolved and its schema validated before a task mutation. The publisher does not inspect a parent page, discover a same-named database, or create a destination database. Its required durable task schema is exactly `Identifier`, `Title`, `State` (`rich_text`), `Priority`, `Labels`, and self-relation `Blocked By`. Existing legacy or user properties are not deleted and are ignored. Page ID, URL, and timestamps remain Notion provider metadata; Symphony-only values are not publisher properties.

For a successful publication the page has exactly one direct child page named `Plan` and one named `Workpad`. The `Plan` page contains the complete non-empty accepted Plan as paragraph content; `Workpad` starts empty. This replaces the old body-heading convention—there is no `# Plan`/`# Workpad` boundary in the task body. Native Notion comments remain separate.

The parent page is first created with `State: Publisher Pending`. That state is publisher recovery
state, not a task-lifecycle state. The publisher creates and validates both child pages before
changing State to the fixed publication handoff `Ready`. Retrying finds a sole `Publisher Pending`
match and repairs it without duplicating either page; a sole completed match is rejected as a
duplicate. Two or more matching identifiers always fail with an Identifier invariant violation,
without selecting or changing any match. Completed tasks are not reclassified or repaired if a
human later changes their child-page structure.
