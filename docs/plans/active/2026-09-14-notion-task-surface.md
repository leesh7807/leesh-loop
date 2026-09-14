# 2026-09-14-notion-task-surface

## Objective

Refine the canonical Notion task representation so the task page body is the
Workpad and the accepted Plan is one separate immutable Plan page selected by
the task's explicit `Plan` relation. Remove the previous `Plan` and `Workpad`
child-page convention without migration or compatibility fallback.

## Definitions

- **Task data source**: the data source containing executable task pages and
  durable task metadata.
- **Plan data source**: the sibling data source under the configured database
  container containing accepted Plan snapshots.
- **Publication identity**: the shared `Identifier` written to the task and
  its Plan page; relation selection is valid only when the identifiers match.
- **Workpad**: direct blocks of the task page, mutable runtime/result content,
  excluded from `Tracker.Issue.description`.
- **Comments**: task-page comments, independent human-review input.

## Intent

Opening a task should expose the working surface immediately. The accepted Plan
has a separate lifecycle and must remain immutable worker input, while runtime
notes and results belong directly to the task body. Plan resolution must be
provider-native and deterministic rather than dependent on names, ordering, or
page body structure.

## Decisions

- The configured URL continues to identify one Notion database container. The
  publisher structurally resolves exactly one task-compatible data source and
  one unambiguous Plan data source, creating the Plan source when absent.
- The task schema keeps `Identifier`, `Title`, `State`, `Priority`, `Labels`,
  and self-relation `Blocked By`, and adds relation `Plan` targeting the Plan
  data source. The Plan source contains only its durable `Identifier` and
  `Title` identity fields.
- Publisher creates/reuses one pending task and one matching Plan page,
  writes the complete Plan only to the Plan page, locks it, wires exactly one
  task-to-Plan relation, validates source ownership and equal identifiers, and
  finalizes only after validation. Retries complete missing Plan content only
  while pending; completed publications are never repaired.
- Provider schema reads may omit `single_property` for a single relation; a
  relation is accepted structurally when it targets the expected data source
  and has no `dual_property`. Publisher writes the provider's explicit
  `single_property` relation shape and validates the authoritative readback.
- The adapter follows only the task's `Plan` relation, verifies the target
  source and publication identity, and builds `Issue.description` only from
  Plan blocks. Missing, multiple, malformed, out-of-scope, mismatched, or
  empty Plans are malformed task representations. Child pages, task body,
  comments, links, and text are never Plan fallbacks.
- `notion_task_append_workpad` appends paragraphs directly to the bound task
  page. Comment reads and state mutation remain task-local and independent.
- No migration code, legacy child-page fallback, generic page mutation tool,
  or Plan mutation worker path is added.

## Verification

- Fake-provider publisher tests observe multi-data-source bootstrap, structural
  task/Plan source discovery, Plan schema and relation wiring, exact Plan
  content, UI lock, empty task body, pending recovery, identity ambiguity and
  cross-binding rejection, and completed-Plan immutability.
- Adapter tests observe explicit relation resolution, source ownership and
  identifier equality, metadata/blocker normalization, task-body exclusion,
  deterministic malformed cases, pagination, and rejection of child-page
  fallbacks.
- Agent-tool tests observe direct task-body append and unchanged independent
  comment pagination.
- Run publisher tests/build, targeted and complete Symphony tests, formatting,
  static/spec checks, and `git diff --check`. Run a disposable live Notion
  smoke test when credentials and a target are available; report unavailable
  external verification precisely.
- Compare the final implementation with this plan, move it to
  `docs/plans/completed/`, commit/push/open the PR, and complete the required
  `chatgpt-shot` review/fix/re-review loop against each exact PR HEAD.

## Verification Tools

- `notion_publisher` fake-provider tests and normal publisher entry point:
  verify the durable provider representation and recoverable publication.
- Symphony Notion adapter and agent-tool tests: verify normalization, direct
  Workpad append, comment isolation, and malformed-task behavior.
- Notion API against a disposable database: verify actual relation navigation,
  page locking, direct task-body blocks, and comments.
- Repository test, build, formatter, static/spec, diff, PR, and independent
  review commands: verify delivery and review evidence.

## chatgpt-shot review log

### Round 1

- 리뷰한 HEAD: `da315be4a9adb5bc273d44e3c9a24b505a4b4365`
- verdict: `FINDINGS`
- Finding 수용: finalize 직전 task Identifier readback이 없어 외부 변경 후에도 Ready가 될 수 있었고, Plan source 판별이 임의의 추가 속성을 허용했다. 둘 다 현재 경로에서 재현되어 수정했다.
- 적용 커밋: `e00cd61` (`Validate canonical publication identity and Plan schemas`)
- 검증: publisher `npm test` 18개 통과; Symphony Notion 대상 16개, format check, `specs.check` 통과.
