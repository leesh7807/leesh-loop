# Notion plan publisher

Build and run from any directory with explicit artifact and configuration paths:

```text
npm install
npm run build
node /path/to/publisher/dist/cli.js \
  --plan /path/to/plan.md \
  --config /path/to/config.yaml
```

The publisher reads `NOTION_TOKEN` from the process environment or the publisher worktree's
`.env`. It bootstraps or reuses a `Tasks` data source beneath `parent_url`, rejects duplicate
`Identifier` values, preserves the complete Markdown under `Plan`, and creates an empty
`Workpad` heading. It never stores machine-local plan paths in Notion.
