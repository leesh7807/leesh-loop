# Notion Adapter Contract

## Objective

Implement `notion` as a thin Symphony tracker adapter over the Publisher-owned
Notion execution surface. `WORKFLOW.md` is the sole runtime authority for the
selected Notion database; the Publisher and adapter consume that same resolved
`tracker.provider.database_url`.

## Boundaries

- Publisher creates and normalizes the schema, properties, state vocabulary,
  `Blocked By` relation, and Plan/Workpad page convention.
- Adapter validates and consumes that representation. It does not repair
  schema, invent state translation, dependency policy, or dispatch policy.
- Page id is `Issue.id`; `Identifier` is `Issue.identifier`; Plan is worker
  input and Workpad is excluded.
- Client owns Notion API reads, pagination, blocks, and provider requests.
  Agent tools are restricted to page reads/comments, represented-value updates,
  and appending blocks; they cannot modify database schema.

## Delivery and verification

1. Remove Publisher-owned environment database selection and resolve the
   execution surface from the supplied `WORKFLOW.md`.
2. Add `adapter.ex`, `client.ex`, and `agent_tool.ex`, registering `notion` in
   Symphony's existing tracker selection path.
3. Test normalization, identity, Plan/Workpad separation, schema/API failure,
   pagination, ID fetches, and narrow tools.
4. Run the Publisher test suite, Symphony quality gates, and a temporary
   `WORKFLOW.md` through the normal Symphony CLI against the designated
   Symphony Tasks database. Verify external reads/mutations by Notion readback.
