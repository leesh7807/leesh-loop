# Notion plan publisher

The publisher core is an in-process capability. It receives the complete UTF-8 Plan content, a resolved Notion database URL, a Notion client, resolved publication policy, and (when the Plan has no Markdown H1) a caller-resolved fallback title:

```ts
publish({ plan, databaseUrl, fallbackTitle, client, config })
```

The core owns Notion publication semantics: identifier and title derivation, schema validation, duplicate detection, incomplete-publication repair, block append ordering, and finalization. A heading-less Plan must supply `fallbackTitle`; this preserves a meaningful title without making a path part of the core contract. It does not accept paths or discover a destination through `.env`, `process.env`, `WORKFLOW.md`, Symphony, or the Notion adapter.

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

Optional policy settings in the JSON configuration are `state` (default `Ready`), `priority` (default `3`, or `null`), `labels` (default `[]`), `plan_source`, and `property_names` for supported canonical names. `plan_source` must be an HTTP(S) URL because the corresponding Notion property is a URL. Unknown keys and invalid structural types fail before mutation; state text remains open-ended.

The configured database is resolved and its schema validated before a task mutation. The publisher does not inspect a parent page, discover a same-named database, or create a destination database. Its default policy maps to Symphony's tracker fields (`Identifier`, `Title`, `Description`, `State`, `Priority`, `Labels`, and self-relation `Blocked By`), but it neither reads `WORKFLOW.md` nor runs Symphony. `Plan` is the immutable completed artifact and `Workpad` is the empty local coordination surface.
