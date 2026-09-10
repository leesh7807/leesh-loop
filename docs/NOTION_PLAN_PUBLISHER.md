# Notion plan publisher

The Publisher creates and normalizes the Notion execution surface selected by
the loop's `WORKFLOW.md`. It does not choose a separate publish destination.

```sh
cd notion_publisher && npm install && npm run build
node dist/src/cli.js --plan /path/to/plan.md --config /path/to/publisher-config.json --workflow /path/to/WORKFLOW.md
```

The workflow must select the same Notion surface Symphony reads:

```yaml
tracker:
  kind: notion
  provider:
    database_url: $NOTION_DATABASE_URL
    token: $NOTION_TOKEN
```

`database_url` is the sole execution-surface selection. Environment variables
provide values and secrets only; `NOTION_PUBLISH_DATABASE_URL` and
`NOTION_PUBLISH_TARGET_URL` are not Publisher inputs. The optional JSON policy
config controls Publisher-owned representation defaults (`state`, `priority`,
`labels`, and `plan_source`), not destination. Property names are canonical and
fixed so Publisher and adapter always consume the same representation.

Publisher-created pages use `Identifier`, `Title`, `State`, `Priority`,
`Labels`, `Blocked By`, and `Description`, with a `Plan` section followed by a
`Workpad` section. `Plan` is the worker execution input; `Workpad` is runtime
output and is not republished as task input.
