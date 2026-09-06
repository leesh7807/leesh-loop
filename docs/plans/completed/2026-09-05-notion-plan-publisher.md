# 2026-09-05-notion-plan-publisher

## Objective

Implement a deterministic plan publisher that takes one completed plan document and publishes it as one task record to a configured Notion coordination surface.

The publisher must not reinterpret, summarize, split, or infer planning intent. The completed plan document is already the executable work description. The publisher only materializes that artifact into the configured coordination surface and supplies the coordination fields and page surfaces needed by the later execution path.

The publisher must not assume that it is installed inside a specific repository or executed from that repository's current working directory. It must work from an explicit plan artifact and publication configuration even when executed from a separate checkout, tool repository, wrapper repository, or isolated worktree.

Implementation and verification must occur in an isolated worktree. After implementation and verification are complete, move this plan document from `docs/plans/active/` to `docs/plans/completed/`, then commit the final state and submit the change to `main` through a Pull Request.

## Definitions

### Plan Artifact

A completed Markdown plan document produced by the planning process.

For publication, one plan artifact maps to one coordination task record.

The Markdown content of the plan artifact is preserved as the immutable task description rather than being decomposed into separate semantic fields.

### Plan Publisher

A deterministic CLI program that reads:

- one plan artifact;
- publication configuration;
- a host-provided secret;
- and creates the corresponding Notion task record.

The publisher does not perform planning.

Its execution location is independent of the location of the input artifact or the repository for which the plan was created.

### Publication Configuration

Provide non-secret publisher settings in a separate configuration file. The configuration path must be passable explicitly to the CLI and does not need to live inside a particular repository.

Configuration should contain only publication concerns, such as:

- target Notion parent page URL;
- initial state;
- default priority;
- default labels;
- supported canonical property-name overrides;
- values needed for duplicate behavior;
- bootstrap surface name.

Support a Notion page URL so the user does not need to manually extract an internal Notion ID. Keep configuration narrow. Do not expose arbitrary Notion schema construction through configuration.

### Configuration Validation

Publication configuration is a typed input surface.

- An omitted field uses the documented default when applicable.
- A supplied field with the required structural type is preserved and applied.
- A supplied field with the wrong structural type fails clearly.

The publisher must not silently coerce malformed supplied configuration into an omitted value, an empty value, or a default.

Examples:

```yaml
labels: notion
```

is invalid when labels requires a list.

```yaml
state:
  - Ready
```

is invalid when state requires a string.

```yaml
state: Ready
```

is valid because the value has the required shape. The publisher must not reject it merely because `Ready` is absent from a built-in state vocabulary.

Unknown or misspelled configuration keys must fail clearly rather than being silently ignored. Key names are part of the configuration schema; this does not imply that string values are closed vocabularies.

Field-specific semantic restrictions remain explicit and narrow:

- `parent_url` must have the required URL representation;
- `state` must be a non-empty string, but its text is not membership-validated against the built-in bootstrap state list;
- `priority` must use the numeric/null representation and supported priority semantics defined by this plan;
- `labels` must be a list of strings; label text remains open and is normalized mechanically;
- `plan_source`, when present, must use the supported string/URL representation rather than being coerced from another data type.

Do not infer additional semantic restrictions from defaults.

### Policy Injection

Implement the canonical schema, initial page structure, and publication behavior as an explicit policy object rather than scattering assumptions through Notion API code.

Internally, the publisher should receive that policy as a dependency. Production uses the default Symphony-compatible coordination policy. Tests may inject alternate policy objects.

Supported configuration may override selected values in the default policy, but canonical field semantics and the Plan/Workpad distinction remain code-owned.

The policy must define how the Workpad section is created but does not need to define later Workpad mutation behavior.

## Pre-execution Credential Provisioning

Before work begins, the user will prepare a temporary `.env` file at the root of the current project directory:

```text
<project-root>/.env
```

The file must contain the Notion API credential under exactly this environment-variable name:

```text
NOTION_TOKEN=<notion-api-token>
```

The executor may assume only that the project-root temporary `.env` contains the credential under `NOTION_TOKEN`. It must not assume any additional secret fields.

After creating the isolated implementation worktree, copy the temporary `.env` from the project root into the worktree root.

The copied `.env` must remain untracked by Git, never be committed, never be included in the Pull Request, never be copied into source code or fixtures, and never be exposed in logs, generated configuration, or task contents.

The implementation must support `NOTION_TOKEN` as its runtime credential.

Do not implement OAuth, OS credential storage, secret-manager integration, or multi-user credential handling in this work.

## Secret Runtime Behavior

At runtime, the publisher uses `NOTION_TOKEN` as its Notion API credential.

If `.env` loading is supported, its purpose is only local execution convenience. Do not make plan/config path resolution depend on the `.env` location.

If `NOTION_TOKEN` is unavailable, empty, or unusable, fail clearly before or at the first authenticated Notion operation as appropriate.

## Notion Target and Schema Bootstrap

The configured Notion page is the parent under which the publisher creates or discovers its coordination surface.

On first use, the publisher may create the coordination database/data source and canonical schema beneath that parent. The user should not need to manually construct all required Notion properties.

When no publisher-owned coordination surface exists under the configured target:

- create the Tasks data source;
- create the canonical properties;
- create the `Blocked By` self relation;
- make the same surface deterministically discoverable on later runs;
- publish the requested plan using the canonical Plan/Workpad page structure.

Bootstrap must be safe to run repeatedly and must not create unintended duplicate surfaces.

Bootstrap is complete only after every required publisher-owned schema element has been established. The bootstrap operation is an initialization unit: a surface is marked complete only after the full canonical schema, including `Blocked By`, exists.

A provider failure may occur after the Tasks data source has been created but before bootstrap is complete. That failure must not leave the publisher permanently unable to use the same target on a later invocation.

A later invocation must be able to complete bootstrap safely, or the failed bootstrap must clean up enough publisher-created state to permit a clean retry. Recovery must not require manual Notion repair for schema state created by the publisher during the failed bootstrap.

The required distinction is:

```text
unrelated or pre-existing incompatible surface
    -> report incompatible schema

publisher-created incomplete bootstrap
    -> recover, resume, or clean up so bootstrap can be retried
```

Use the simplest deterministic recovery strategy supported by the provider.

Do not implement automatic migration of incompatible existing coordination schemas. In particular, do not automatically change property types, rename ambiguous existing properties, rewrite existing records, migrate relation structures, transform historical values, or convert arbitrary existing page content into canonical Plan/Workpad sections.

When an existing publisher-owned complete surface is selected, reuse the bootstrap schema invariants as a cheap fail-fast check. `Blocked By` must retain the expected self-relation shape before publication proceeds. A complete surface with externally drifted schema is incompatible; ongoing surface integrity synchronization is outside publisher scope.

## Duplicate and Publication Failure

Publishing the same plan repeatedly must not silently create duplicate executable tasks.

Derive a deterministic publication identity from the plan artifact. Before creating a task, detect an existing record with the same canonical Identifier. For v1, treat an existing record as a duplicate and fail clearly rather than turning publication into update or synchronization behavior.

A failed publication must not leave a publisher-created partial task in a state that prevents the same plan from being published again. If task creation begins successfully but later publication of required Plan content fails, clean up the incomplete publication or otherwise ensure that it cannot block a retry through duplicate detection.

This requirement applies to the publication transaction itself. It does not extend to later Workpad mutations, which are outside publisher scope.

## Notion API Errors

Distinguish failures sufficiently for a user or agent to identify the corrective action. At minimum, make these cases clear:

- missing configuration;
- missing `NOTION_TOKEN`;
- invalid target URL;
- target inaccessible to the integration;
- authentication failure;
- incompatible schema;
- duplicate publication;
- provider/API failure.

Do not hide a known provider failure category behind a generic publication error.

## No Synchronization or Multi-user Flow

The publisher creates coordination records from plan artifacts. It does not synchronize later changes between the repository plan and Notion, pull Notion changes back into the plan artifact, or implement OAuth, account onboarding, token storage services, or multi-tenant credential handling.

The Workpad is intentionally reserved for later mutable execution coordination. Reading and updating Workpad belongs to later coordination/execution integration.

## Relationship to Symphony

The publisher does not invoke or control Symphony itself. It materializes a coordination record in Notion that contains both the structured issue surface needed by the Symphony execution path and the local coordination-specific empty Workpad surface reserved for later use.

The responsibility boundary is:

```text
Planner
   ↓
Plan Artifact
   ↓
Plan Publisher
   ↓
Notion Coordination Surface
   ├─ Structured Issue Data
   ├─ Plan
   └─ Empty Workpad
   ↓
Tracker / Coordination Adapter
   ↓
Symphony
   ↓
Worker
```

The publisher needs the tracker-facing Symphony issue contract to define the structured execution fields. Symphony responsibilities such as workspace lifecycle, concurrency, retry behavior, and Codex execution are outside publisher scope.

## Worktree Isolation and Completion

Implement this plan in a dedicated isolated worktree. This does not mean that the publisher itself must run from inside a particular repository. Worktree isolation is the development method used to separate this implementation from the main working tree and establish the Pull Request boundary.

After creating the worktree, copy the user-provided temporary `.env` from the project root into the worktree root so it can be used for live Notion verification. The copied `.env` must remain untracked.

After implementation and verification, confirm that the worktree contains only changes belonging to this plan, complete automated tests and live Notion verification, move this plan from `docs/plans/active/` to `docs/plans/completed/`, inspect the final state, commit the coherent final implementation, push the implementation branch, and open a Pull Request targeting `main`. Do not merge directly into `main`.

## Verification

Verification must show that the publisher can create a complete coordination task in Notion from explicitly provided plan and configuration inputs, independent of execution location.

### Upstream Symphony Contract Verification

Inspect the current tracker-facing behavior of upstream Symphony and demonstrate that the canonical structured policy contains the issue semantics required by the actual execution path. At minimum verify required issue identity, identifier/title/body use, state use, active/terminal handling, blocker representation and dispatch effect, and priority/label use.

The mapping from each canonical Notion structured field to these requirements must be traceable in implementation or documentation. Also verify that Workpad is treated as a local coordination-specific surface rather than incorrectly forcing it into the upstream Symphony tracker contract.

### Execution-location Independence

Verify all of the following:

- run the CLI from a directory other than the publisher source directory;
- use a plan artifact outside the publisher repository;
- use a configuration file outside the publisher repository;
- make relative-path resolution, if supported, explicit;
- verify absolute paths.

### Configuration Parsing

Demonstrate valid configuration, deterministic Notion URL parsing, supported overrides, omitted defaults, preservation of correctly typed values, clear wrong-type failures, rejection of malformed supplied input, rejection of unknown keys, missing required configuration before publication, open-ended state values, and deterministic malformed-input tests for `state`, `labels`, `priority`, and `plan_source`.

### Credential Provisioning

Confirm the project-root temporary `.env` contains `NOTION_TOKEN`, copy it into the isolated worktree, verify that the publisher reads it, verify both files remain untracked, and verify that the credential does not appear in commits, Pull Request diff, logs, fixtures, generated artifacts, or task contents. Missing or empty `NOTION_TOKEN` must fail clearly and no additional secret field may be required.

### Policy Behavior

Using automated tests, demonstrate that the default policy completely defines the structured coordination schema and canonical initial Plan/Workpad structure, that Notion request construction consumes the policy, that an alternate policy can be injected in tests, and that supported configuration overrides modify only intended policy values.

### Bootstrap, Existing Surface, and Retry

Against a controlled Notion test target, demonstrate parent accessibility, creation of the Tasks data source, canonical property types, the `Blocked By` self relation, continued publication after bootstrap, a populated Plan, and a distinct empty Workpad.

Run bootstrap again and confirm compatible surface reuse. Deterministically exercise provider failure after publisher-owned surface creation begins and verify later retry completes the canonical surface without manual repair, does not create an unintended duplicate publisher surface, and does not silently migrate an unrelated incompatible surface.

Demonstrate compatible existing-surface discovery and rejection of incompatible required properties. A same-named but unowned database must be rejected even if its property types happen to be compatible. Child-block discovery must follow provider pagination rather than being limited to the first 100 blocks.

### Successful Publication

Publish a representative completed plan artifact and verify directly in Notion that exactly one task exists, the identifier and title are correct, initial state and configured/default priority and labels are correct, the complete plan is preserved in the Plan section, long source lines are chunked without content loss, a distinct empty Workpad exists, no planning interpretation appears in either section, and all structured fields required for later Symphony-compatible issue conversion are present.

### Duplicate and Partial Failure

Publish the same plan a second time and verify that no additional task is created and the command exits with an explicit duplicate-publication result.

Using a deterministic automated or controlled failure, demonstrate that failure after task creation begins does not leave an incomplete task that prevents safe retry. Bootstrap has the equivalent retryability requirement. Do not extend either requirement to later Workpad mutations.

### Authentication and CLI Result

Verify a controlled invalid-token or inaccessible-target path with recognizable authentication or permission failure. The CLI exits successfully only after confirmed publication, returns or prints the created task identity on success, uses non-zero status on failure, and provides actionable output without exposing secrets.

## Automated Tests

Add deterministic tests for configuration validation, path resolution, URL/identifier parsing, policy resolution, publication metadata derivation, duplicate decision logic, Notion request construction, schema compatibility and self-relation validation, canonical Plan/Workpad construction, error mapping, request batching, rich-text chunking and reconstruction, partial-publication cleanup, partial-bootstrap recovery and safe retry, and structural validation that rejects malformed types without treating open-ended strings as closed vocabularies.

Use fake or injected Notion clients where appropriate so ordinary tests do not depend on external network access.

The following are not requirements of this plan: general Workpad reads, Workpad replacement, Workpad update batching, Workpad mutation rollback, Workpad internal-heading parsing, and Workpad concurrency behavior.

## Intended-path Verification Evidence

Perform at least one live end-to-end publication using a real Notion integration and a controlled test parent page. The evidence must show:

```text
project root/.env
        ↓ copy
isolated worktree/.env

plan artifact at arbitrary location
        +
publication config at explicit location
        ↓
publisher CLI
        ↓
bootstrap or compatible-surface discovery
        ↓
Notion coordination record
        ├─ structured issue properties
        ├─ complete Plan
        └─ distinct empty Workpad
        ↓
surface ready for later coordination integration
```

Inspect the resulting record directly in Notion. No later Workpad mutation is required.

## Plan and Pull Request Completion Verification

Before creating the Pull Request, confirm implementation and required verification are complete, the plan has been removed from `docs/plans/active/`, the same plan exists under `docs/plans/completed/`, and the moved plan still matches the final implementation state.

Before opening the Pull Request, run applicable repository checks and publisher-specific tests, perform live Notion publication verification, verify Plan/Workpad separation and initial empty Workpad state, move the plan, inspect final repository state and diff against the intended `main` base, and confirm no secret or `.env` content is included.

## Verification Tools

Use the upstream Symphony source and specification to determine the tracker-facing issue contract; the automated test runner for deterministic publisher behavior; the TypeScript type checker and repository linter/checks; the project-root temporary `.env` for live verification; the Notion test parent page for bootstrap, schema inspection, publication, duplicate protection, and permission verification; the Notion API/official JavaScript client for the actual provider path; an isolated Git worktree for development isolation; Git diff for scope and secret inspection; the completed plan location for repository evidence; and the Pull Request for review evidence.
