# 2026-09-10-notion-adapter

## Objective

Add a `notion` Symphony tracker adapter that mechanically consumes the Publisher-managed Notion execution surface and exposes existing Symphony tracker and dynamic-tool boundaries.

## Definitions

- **Publisher-managed surface**: the Notion data source and page structure created or validated by the Publisher.
- **Plan section**: the published page section that is the execution input. It becomes `Tracker.Issue.description`.
- **Workpad section**: runtime output on a task page. It is excluded from `Tracker.Issue.description`.

## Decisions

- The adapter consumes, but never creates, repairs, configures, or reinterprets the Publisher schema.
- Notion page ID is `Issue.id`; the `Identifier` property remains `Issue.identifier`.
- State is passed through directly. The adapter does not introduce dispatch or dependency policy.
- `Blocked By` is normalized as the existing `Issue.blocked_by` relation. Missing, inaccessible, or malformed relations that would change execution meaning fail clearly.
- Provider configuration contains only Notion connection and execution-surface location information. It has no property-name overrides or schema definition.
- The client owns HTTP, pagination, page/block access, and provider errors. The adapter owns normalization. Agent tools expose narrowly scoped Notion-native page/property mutations and do not mutate schema.

## Verification

The adapter proves a Publisher-compatible task maps its page ID, Identifier, title, Plan content, state, priority, labels, Blocked By relation, URL, and timestamps to `Tracker.Issue`, while excluding Workpad content. It fails incompatible schemas and provider failures without returning a successful empty result, completes pagination, and works through Symphony's ordinary tracker discovery path. A translation preview records the representative source-to-issue mapping.

## Verification Tools

- Focused ExUnit tests validate mapping, pagination, errors, callback registration, and tool scope through injected Notion API responses.
- Symphony's ordinary tracker/orchestrator tests exercise discovery after selecting `tracker.kind: notion`.
- A real Publisher-created Notion surface is read through the configured adapter when non-secret local credentials and surface configuration are available; direct Notion API readback verifies any agent-tool mutation.
