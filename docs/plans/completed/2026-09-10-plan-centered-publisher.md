# 2026-09-10-plan-centered-publisher

## Objective

Refactor the Notion publisher from a file-oriented CLI program into a reusable Plan-oriented capability. The publisher accepts Plan content and an explicit publication destination. It does not discover either input from files, environment variables, `WORKFLOW.md`, Symphony, or the Notion adapter.

Keep the existing CLI as one invocation path around the same publisher core. Do not introduce a standalone publisher service, HTTP protocol, daemon, or adapter layer.

## Definitions

**Plan** — The complete UTF-8 Plan content to publish. It is the publisher's canonical domain input regardless of whether it originated from a repository file, web UI, agent, or another caller.

**Publication destination** — The resolved Notion database binding supplied by the caller to the publisher. The publisher does not determine where this value originated.

**Operator** — The upper Leesh Loop surface responsible for project-level coordination and configuration. It owns the authoritative Notion database binding for a project. `WORKFLOW.md` may contain the corresponding tracker binding for Symphony runtime use, but the publisher does not read or interpret that file.

**Publisher core** — The reusable in-process capability that receives a Plan and publication destination and performs the existing Notion publication behavior. It owns publication semantics, not input discovery.

**CLI** — One caller of the publisher core. It may read a Plan file or other CLI-specific input, resolve credentials and invocation-specific dependencies, then call the publisher core.

## Decisions

- The publisher core accepts Plan content rather than a Plan path.
- The publisher core accepts the publication destination explicitly rather than reading `NOTION_PUBLISH_DATABASE_URL` from `process.env` or `.env`.
- Its conceptual boundary is `publish({ plan, databaseUrl, client, config })`: Plan content plus a resolved destination flow to the publisher core, then to Notion.
- Filesystem paths, environment lookup, `WORKFLOW.md` parsing, Symphony configuration or lifecycle, and Notion-adapter configuration discovery are not part of the publisher core contract.
- The upper operator owns the authoritative project-level Notion database binding. Materializing or validating a corresponding Symphony tracker binding in `WORKFLOW.md` is outside the publisher's responsibility.
- Remove `NOTION_PUBLISH_DATABASE_URL` as a publisher-owned environment configuration path. `NOTION_TOKEN` remains a runtime secret resolved at the invocation boundary.
- The CLI remains supported as a convenience path: it may read a Plan file, resolve invocation-specific inputs, and forward Plan content to the shared core.
- Callers convert transport-specific inputs into Plan content before invoking the core. Do not add transport-specific core inputs or a second publisher implementation.
- Preserve identifier derivation, title handling, schema validation, duplicate detection, incomplete-publication recovery, mutation ordering, and finalization. Make any semantic input formerly derived from `planPath` explicit, or remove it if it has no domain meaning.
- A heading-less Plan requires a caller-resolved fallback title. The CLI supplies its filename as that fallback, preserving its prior observable behavior without passing a path to the core.
- The core serializes concurrent publication calls for the same database and Plan within one process. The operator must serialize that pair across processes or hosts because Notion supplies no cross-process uniqueness or transaction.

The intended boundary is:

```text
Operator project config
 ├─ project root
 ├─ workflow path
 └─ Notion database binding  ← authoritative

            │
            ├──────────────→ publisher(plan, database binding)
            │
            └─ materialize / validate
                       ↓
                  WORKFLOW.md
                       ↓
                   Symphony
                       ↓
                Notion adapter
```

The publisher participates only in the publication path.

## Verification

- A publisher-core test publishes Plan content that was never written to a filesystem path, using a destination passed directly by the caller.
- Core tests pass with no Plan file, configuration path, `NOTION_PUBLISH_DATABASE_URL`, local publication `.env` destination, or `WORKFLOW.md` available.
- Defining or changing `NOTION_PUBLISH_DATABASE_URL` cannot override the caller-supplied destination.
- Existing publication semantics continue to pass, changing setup only where it relied on the removed file/environment boundary.
- Concurrent in-process calls for the same destination and Plan create at most one task; documentation states the remaining cross-process single-writer requirement.
- A heading-less file-based Plan retains its filename-derived CLI title, while a heading-less direct core call requires a caller-supplied fallback title.
- A caller with Plan content, an operator-resolved destination, and valid credentials can publish without a temporary file, `WORKFLOW.md`, Symphony, adapter configuration discovery, `NOTION_PUBLISH_DATABASE_URL`, a CLI process, or IPC.
- CLI integration verifies its file-based input is read outside the core and forwarded as Plan content to the shared core with the same publication semantics.
- Documentation distinguishes caller/operator authority and input acquisition from publisher-core publication semantics.

## Verification Tools

- Publisher unit tests verify direct Plan-content input, explicit destination injection, and existing publication behavior.
- CLI integration tests verify file input is converted to Plan content before entering the core.
- Environment-isolation tests verify the core neither discovers nor overrides destinations through `NOTION_PUBLISH_DATABASE_URL`.
- Existing Notion client fakes verify database resolution, schema checks, lookup, creation, block append, repair, and finalization on the shared path.
- The TypeScript compiler verifies all callers use the explicit Plan-and-destination contract.
- Repository documentation review verifies the intended authority and input boundaries.
