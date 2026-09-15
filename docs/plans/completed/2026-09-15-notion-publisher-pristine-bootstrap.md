# 2026-09-15-notion-publisher-pristine-bootstrap

## Objective

Make the configured Notion database follow exactly one publisher path: publish an
already canonical database, bootstrap a pristine database and publish, or fail
without migration. The configured database URL is the only destination identity.

## Contract

- Canonical task properties are `Identifier` rich_text, `Title` title, `State`
  select, `Priority` number, `Labels` multi_select, `Blocked By` non-dual
  self-relation, and `Plan` non-dual relation to the canonical Plan source.
- The canonical Plan source has only `Identifier` rich_text and `Title` title.
  Existing State options neither add nor remove canonical status.
- A pristine candidate is the sole data source, has exactly one title property,
  no rows, and no other user property. Its title identity is renamed to `Title`.
- Recover only exact, non-destructive prefixes emitted by bootstrap. Do not infer
  a migration for rows, custom properties, incompatible property types,
  ambiguous task sources, or meaningful secondary sources.
- Bootstrap creates the Plan source, task properties and required relations; it
  verifies the result before publication and may resume an exact prior prefix.
- `State` is a Notion select. Bootstrap seeds the injected policy list; the
  production default is `Backlog`, `Ready`, `In Progress`, `Human Review`,
  `Rework`, `Merging`, `Done`, `Cancelled`. `Backlog` is the sole queue-state
  addition to the workflow vocabulary. This is not an allowed-state enum:
  runtime may write another exact State name through Notion's select path.
- Non-canonical destinations fail with:

  ```text
  The selected Notion database is not empty or does not match the canonical Leesh Loop schema.
  Use an empty database or a database already initialized with the canonical Leesh Loop schema.
  ```

## Verification

Exercise the normal publisher with a request-recording Notion fake for pristine
bootstrap (`Name` to `Title`), canonical reuse, exact bootstrap-prefix retry,
unsupported non-empty/custom/legacy State cases, direct binding, seeded and
injected State policy, select read/write, and existing duplicate/pending/Plan
content/locking/relation behavior. Run TypeScript build, publisher tests, and
`git diff --check`.
