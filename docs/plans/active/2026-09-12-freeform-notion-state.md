# 2026-09-12-freeform-notion-state

## Objective

Decouple the repository workflow state vocabulary from the Notion schema while
preserving the Leesh Loop publication-to-execution contract. Store canonical
Notion `State` values as free-form `rich_text`, keep Publisher recovery and
finalization deterministic, and let the Notion adapter read and mutate the same
provider-native strings.

## Definitions

- **State**: the provider-native string stored in the Notion `State` property.
- **Workflow state vocabulary**: the exact state names and meanings defined by
  this repository's `WORKFLOW.md` and interpreted by Symphony.
- **Publisher Pending**: the Publisher-owned transient state for incomplete
  publication.
- **Ready**: the fixed successful-publication handoff state to Symphony.
- **Canonical task representation**: canonical metadata plus exactly one direct
  `Plan` child page and one direct `Workpad` child page.
- **Integration contract**: a behavior or representation shared across the
  Publisher, Notion surface, adapter, and workflow.

## Intent

The Notion task surface records state without enumerating the workflow's state
vocabulary. Adding or renaming a workflow state therefore remains task-data and
workflow work, not a Notion schema-option change. The Publisher stays unaware
of `WORKFLOW.md`, Symphony configuration, and the repository's complete state
list.

## Decisions

- The canonical Notion `State` property is `rich_text`; bootstrap creates it
  that way and compatible surfaces are reused without unnecessary mutation.
- Existing incompatible required properties, including `State: select`, fail
  with an incompatible-schema error. No conversion, replacement property,
  historical rewrite, or implicit migration is attempted.
- Publisher-owned state is limited to exact strings `Publisher Pending` and
  `Ready`. New and recoverable incomplete publications use the former; only
  validated canonical representations are finalized to the latter.
- Publisher state reads and writes, adapter normalization, state queries, and
  worker transitions use complete exact `rich_text` strings without mapping,
  normalization, case folding, or membership validation.
- `Identifier`, `Title`, `Priority`, `Labels`, `Blocked By`, `Plan`, and
  `Workpad` retain their current semantics. `WORKFLOW.md` keeps its exact state
  contract unchanged.
- README documentation distinguishes upstream Symphony runtime behavior from
  Leesh Loop's fixed `Ready` handoff and canonical task representation, and
  points to the upstream Symphony specification for detailed runtime rules.
- This plan does not implement migration from older incompatible schemas or
  automatic rewriting after workflow-state renames.

## Verification

- Publisher tests prove fresh `rich_text` bootstrap, compatible reuse, clear
  rejection of incompatible `select` surfaces without migration behavior, and
  exact `Publisher Pending` → `Ready` publication/recovery semantics.
- Adapter tests prove `rich_text` schema compatibility, exact state query and
  normalization, exact worker mutation including a state outside old Publisher
  vocabulary, and unchanged workflow-driven active-state behavior.
- Run Publisher tests/build, the complete Symphony quality/test gates and
  specification checks, README/documentation checks, and `git diff --check`.
- Where credentials and a disposable Notion surface are available, verify the
  live Publisher → Notion → Symphony path and direct exact-string readback.
- Before handoff, submit the actual PR URL and exact `git rev-parse HEAD` to
  `chatgpt-shot`, independently revalidate every finding against that HEAD,
  fix only evidenced defects, and repeat review after any fix-created HEAD.

## Verification Tools

- `notion_publisher` unit and fake-provider tests verify Publisher schema and
  recovery contracts.
- `symphony` Notion client/agent-tool tests verify adapter reads, queries, and
  mutations at the request boundary.
- Direct Notion API readback and a disposable live runtime exercise verify the
  intended external flow when credentials are available.
- Repository test/quality commands, `mix specs.check`, `git diff --check`, and
  `chatgpt-shot submit` provide delivery evidence.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `7afcd5866fb94dc967dd4d9918c1802bb69031d1` on [PR #15](https://github.com/leesh7807/leesh-loop/pull/15).
- Verdict: `PASS` (`None.`).
- Findings: none; the completed Result confirmed the specified HEAD and found no
  evidence-backed defect.
- Applied commit: none; no finding required a code change.
- Verification: Publisher `npm test` passed (16/16); Notion adapter target
  passed (4/4); `mix specs.check`, `mix format --check-formatted`, and
  dialyzer passed; `git diff --check` passed. Full `mix test` had a passing
  299-test run, while later coverage/full runs exposed existing retry-timing
  boundary flakes and aggregate quality limits from existing Credo findings and
  the repository's 100% coverage threshold.
- Submission handling: the first local service attempt produced no Invocation;
  after service restart and exact SHA correction, Invocation readback reached
  `completed` and returned the PASS Result.
