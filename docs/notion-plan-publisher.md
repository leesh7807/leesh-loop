# Notion plan publisher

The TypeScript CLI publishes one completed Markdown plan as one Notion task. It copies the plan verbatim into a `Plan` section and creates an independent empty `Workpad` section.

Run it from any directory with explicit paths:

```text
npm install
npm run build
node /path/to/publisher/dist/cli.js --plan /any/path/plan.md --config /any/path/publisher.yaml
```

The configuration example is [`publisher.example.yaml`](../publisher.example.yaml). `NOTION_TOKEN` is read from the process environment or the publisher worktree `.env`; its value is never printed. Unknown configuration keys and invalid supported-field types fail before any Notion request. The first run bootstraps a `Tasks` data source, later runs validate it, incompatible schemas fail without migration, and repeated identifiers fail as duplicate publication.

The mapping follows the tracker contract in `symphony/SPEC.md`: the Notion page ID is `id`, `Identifier` is `identifier`, `Title` is `title`, the Plan body is `description`, and `State`, `Priority`, `Labels`, and `Blocked By` map directly. Workpad is coordination-only and is not part of the upstream Symphony issue description.
