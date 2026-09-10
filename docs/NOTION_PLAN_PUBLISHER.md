# Notion plan publisher

The publisher core is an in-process capability. It receives the complete UTF-8 Plan content, a resolved Notion database URL, a Notion client, and resolved publication policy:

```ts
publish({ plan, databaseUrl, client, config })
```

The core owns Notion publication semantics: identifier and title derivation, schema validation, duplicate detection, incomplete-publication repair, block append ordering, and finalization. It does not accept paths or discover a destination through `.env`, `process.env`, `WORKFLOW.md`, Symphony, or the Notion adapter.

Authority and input acquisition belong to the caller. The upper operator owns the authoritative project-level Notion database binding and may separately materialize the matching Symphony tracker binding in `WORKFLOW.md`. Keeping those values synchronized is an operator/bootstrap responsibility, not a publisher responsibility.

The CLI is one convenience caller. It reads a file and configuration, resolves the runtime credential, then forwards Plan content and the explicit destination to the same core:

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
