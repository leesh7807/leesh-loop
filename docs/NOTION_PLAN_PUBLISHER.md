# Notion plan publisher

Run from any directory after installing the publisher package:

```sh
cd notion_publisher && npm install && npm run build
node dist/src/cli.js --plan /path/to/plan.md --config /path/to/publisher-config.json
```

The configuration path and plan path are explicit and are never resolved relative to the source
checkout. `parent_url` is the only required setting. Optional settings are `state` (default
`Ready`), `priority` (default `3`, or `null`), `labels` (default `[]`), `plan_source`,
`surface_name`, and `property_names` for the supported canonical names only. Unknown keys and
wrong structural types fail before any Notion mutation. State text is open-ended; it is not
rejected merely because it is not one of the bootstrap options.

The code-owned default policy maps directly to Symphony's `Tracker.Issue`: `Identifier`, `Title`,
`Description`, `State`, `Priority`, `Labels`, and self-relation `Blocked By`. Symphony dispatches
only issues with a non-terminal configured state, required labels, and no unresolved blockers;
the publisher therefore preserves those fields but does not run Symphony. `Plan` is the
immutable completed artifact and `Workpad` is an empty local coordination surface, intentionally
outside the upstream issue body contract.

The publisher uses `NOTION_TOKEN`. A local `.env` is read only from the process current directory
as a convenience; artifact and configuration resolution never depends on that location. The
supported target input is an HTTP(S) Notion page URL whose host is `notion.so`, a subdomain of
`notion.so`, `app.notion.com`, or a subdomain of `notion.site`, and whose path contains the page id.
Callers are responsible for supplying a URL in that supported form.
