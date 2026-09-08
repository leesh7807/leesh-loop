# 2026-09-08-direct-notion-database-binding

## Objective

Change the Notion plan publisher so its one publish destination is the Notion task database directly bound by `NOTION_PUBLISH_DATABASE_URL`. One publisher execution context represents one project execution context. It projects plan-derived task records directly into that configured recording surface; it does not route projects, infer a database from a parent page, or create a destination database.

## Definitions

- **Project execution context**: the operating unit in which one repository/project's plan, Symphony execution, publisher configuration, and Notion task records work together. Each context has its own `.env`.
- **Publish database**: the one Notion database that records plan-derived tasks and serves as the Symphony coordination surface for an execution context.
- **Direct database binding**: a contract in which `.env` provides the publish database URL and the publisher does not infer the destination from a parent page.
- **Recording surface**: the materialized task-record surface shared by planner, executor, reviewer, and Symphony. Notion records coordination and execution state rather than being the engineering source artifact.
- **Recovery**: an operator prepares a new compatible database, changes `NOTION_PUBLISH_DATABASE_URL`, and republishes the plan. The publisher does not rediscover an old hierarchy or identity.

## Decisions

- One publisher execution context targets one project. Multi-project routing belongs to a higher-level future orchestration concern, not the publisher.
- `NOTION_TOKEN` remains the runtime credential. Replace `NOTION_PUBLISH_TARGET_URL` with `NOTION_PUBLISH_DATABASE_URL`; existing process-environment precedence and current-directory `.env` convenience loading stay unchanged.
- The configured database URL is the only destination identity. Database display title and parent hierarchy are not routing inputs. Moving or renaming the same database must not change the destination.
- Remove parent-page URL parsing, parent child listing, child-database discovery, title/marker destination selection, and destination database bootstrap from the publish path. Do not fall back to a same-name, marker-bearing, historical, or legacy target.
- If the new binding is absent while the legacy key is supplied, fail with an explicit migration error. Do not silently use the legacy key.
- Before task mutation, validate the database URL, extract its identity, retrieve the configured database with the token, resolve its usable data source, and verify the task-record schema. Fail without fallback or destination creation when any validation fails.
- Schema compatibility is distinct from destination identity. Retain safe schema repair only within the configured database identity when it is needed by the existing contract; never select or create another database to remedy schema problems.
- Remove `surface_name` from destination routing and remove it from configuration unless it retains an independent user-visible purpose.
- Preserve existing plan parsing, task mapping, State/Priority/Labels/Blocked By/Plan/Workpad behavior, duplicate detection, retry behavior, single-writer assumption, and Symphony-compatible issue semantics.
- Recovery is performed by replacing only the environment database binding and republishing the unchanged plan into an operator-prepared compatible database.

## Verification

- A valid direct database URL resolves the configured database identity and creates records only in its data source. No parent child listing, sibling inspection, or destination creation occurs.
- Renaming or moving the configured database does not alter the resolved destination.
- A same-named database elsewhere is neither searched nor mutated.
- Missing, malformed, inaccessible, or incompatible bindings fail before task creation, without parent fallback, discovery, or database creation.
- A legacy-only environment fails with an explicit migration message and no Notion mutation.
- Process environment stays authoritative over current-directory `.env`; `.env` supplies the same database URL key when no process value exists, while artifact paths remain independent of `.env` location.
- Existing valid-plan publication preserves properties, dependencies, duplicate handling, retry behavior, and single-writer semantics.
- Changing only `NOTION_PUBLISH_DATABASE_URL` to a newly prepared compatible database republishes the same plan into that new recording surface, with no historical destination discovery.
- Two separate execution contexts with separate `.env` files publish only to their individually configured databases.

## Verification Tools

- Unit tests validate database URL parsing, missing/invalid and legacy-only binding errors, and environment precedence.
- Mock Notion API tests assert that direct resolution does not request child listings, discovery, or destination creation, and that validation happens before task mutation.
- Publisher integration tests cover direct database resolution, schema validation/repair within the same database, task creation, duplicate detection, retry, and dependencies.
- Request recording assertions establish the exact configured database/data-source calls and absence of fallback calls.
- The existing regression suite protects plan parsing and task-record semantics.
- A live smoke test with a configured test database URL and readback, plus a recovery smoke test with a replacement database URL, verifies the real intended path when test credentials are available.
