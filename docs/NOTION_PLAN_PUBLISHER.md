# Notion plan publisher

Run from any directory after installing the publisher package:

```sh
cd notion_publisher && npm install && npm run build
node dist/src/cli.js --plan /path/to/plan.md --config /path/to/publisher-config.json
```

The configuration path and plan path are explicit and are never resolved relative to the source
checkout. The publish database is supplied only as `NOTION_PUBLISH_DATABASE_URL`; configuration has no
publish-location setting. Optional policy settings are `state` (default `Ready`), `priority`
(default `3`, or `null`), `labels` (default `[]`), `plan_source`,
and `property_names` for the supported canonical names only. `plan_source`, when
provided, must be an HTTP(S) URL because the canonical Notion property is a URL property; local
filesystem paths are rejected rather than silently discarded. Unknown keys and
wrong structural types fail before any Notion mutation. State text is open-ended; it is not
rejected merely because it is not one of the bootstrap options.

v1 assumes a single writer for a given plan artifact and coordination target. Callers must not
run concurrent publisher processes for the same target/artifact. Duplicate detection is
deterministic within that operating model; Notion does not provide the transaction/unique
constraint needed for cross-process concurrent publication locking, which is out of scope.

The code-owned default policy maps directly to Symphony's `Tracker.Issue`: `Identifier`, `Title`,
`Description`, `State`, `Priority`, `Labels`, and self-relation `Blocked By`. Symphony dispatches
only issues with a non-terminal configured state, required labels, and no unresolved blockers;
the publisher therefore preserves those fields but does not run Symphony. `Plan` is the
immutable accepted Plan snapshot and `Workpad` is an empty local coordination surface, intentionally
outside the upstream issue body contract.

The publisher uses `NOTION_TOKEN` and `NOTION_PUBLISH_DATABASE_URL`. Process environment values are
authoritative. A local `.env` is read only from the process current directory as a convenience;
artifact and configuration resolution never depends on that location. The supported database binding input
is an HTTP(S) Notion database URL whose host is `notion.so`, a subdomain of
`notion.so`, `app.notion.com`, or a subdomain of `notion.site`, and whose path contains the database id.
Callers are responsible for supplying a URL in that supported form. The configured database is
resolved and its schema is validated before the publisher performs a task mutation. The publisher
does not inspect a parent page, discover a same-named database, or create a destination database.
`NOTION_PUBLISH_TARGET_URL` is rejected when no database binding is configured; migrate it to the
database URL.

For example:

```text
NOTION_TOKEN=secret
NOTION_PUBLISH_DATABASE_URL=https://www.notion.so/Tasks-3d28a26586258052b3ecccc9c33787e3
```
