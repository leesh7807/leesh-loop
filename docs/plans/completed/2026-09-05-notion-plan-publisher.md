# 2026-09-05-notion-plan-publisher

## Objective

Implement a deterministic plan publisher that takes one completed plan document and publishes it as one task record to a configured Notion coordination surface.

The publisher must not reinterpret, summarize, split, or infer planning intent. The completed plan document is already the executable work description. The publisher only materializes that artifact into the configured coordination surface and supplies the coordination fields and mutable execution surface needed by the later execution path.

The publisher must not assume that it is installed inside a specific repository or executed from that repository's current working directory. It must work from an explicit plan artifact and publication configuration even when executed from a separate checkout, tool repository, wrapper repository, or isolated worktree.

Implementation and verification must occur in an isolated worktree. After implementation and verification are complete, move this plan document from `docs/plans/active/` to `docs/plans/completed/`, then commit the final state and submit the change to `main` through a Pull Request.

## Definitions

### Plan Artifact

A completed Markdown plan document produced by the planning process.

For publication, one plan artifact maps to one coordination task record.

The Markdown content of the plan artifact is preserved as the immutable task description rather than being decomposed into separate semantic fields.

### Plan Publisher

A deterministic CLI program that reads:

* one plan artifact;
* publication configuration;
* a host-provided secret;

and creates the corresponding Notion task record.

The publisher does not perform planning.

Its execution location is independent of the location of the input artifact or the repository for which the plan was created.

### Publication Configuration

Configuration that defines where the plan artifact is published and which mechanical publication defaults are applied.

The configuration file may live inside the target repository or elsewhere. Its path must be passable explicitly to the publisher.

Configuration discovery must not depend implicitly on the current working directory.

### Coordination Surface

The shared task-record surface used by execution and review roles.

For this implementation, the provider is Notion.

The coordination surface must contain:

* the structured issue data needed by the Symphony execution path;
* the immutable plan input;
* a mutable workpad used during execution and handoff.

Upstream Symphony defines the minimum structured issue semantics that must be representable. It does not define the entire coordination surface.

### Symphony-Compatible Issue Surface

The minimum issue semantics upstream Symphony expects from a tracker in order to identify runnable work and construct worker context.

The Notion coordination schema must be able to represent this surface.

Inspect the current upstream Symphony implementation and specification to establish how at least the following are consumed:

* stable issue identity;
* human-readable identifier;
* title;
* description/body;
* state;
* priority;
* labels;
* blocker relationships;
* values needed for active/terminal state handling.

The Notion property names and types do not need to reproduce an upstream provider schema exactly.

However, the Notion adapter or later coordination adapter must be able to convert the Notion record into the canonical issue data Symphony expects without additional semantic inference.

### Workpad

A mutable task-owned execution surface maintained during implementation.

The workpad is separate from the plan.

The plan records the intended outcome, decisions, constraints, and verification expectations established during planning.

The workpad records information needed to continue or review execution, such as:

* current progress;
* important findings;
* implementation notes;
* verification evidence;
* unresolved execution concerns;
* handoff information.

The workpad must not be used to rewrite or silently replace the plan.

The publisher initializes the workpad as empty.

Later execution tooling may read and update it.

### Canonical Policy

The code-owned policy that defines the coordination record, Notion schema, and task page structure created by the publisher.

The policy fixes how the Symphony-compatible issue surface and coordination-specific surfaces are represented in Notion.

It defines:

* required coordination fields;
* field semantics;
* Notion property representations;
* task page content structure;
* default values;
* bootstrap behavior;
* validation rules;
* publication behavior.

The default policy must be complete and usable without requiring a separate repository-specific schema definition.

### Configuration Override

A supported configuration value that changes an explicitly allowed part of the default publication policy.

Overrides may change values such as property names or the initial state.

They must not allow the semantics of the canonical fields, Plan surface, or Workpad surface to become arbitrary.

### Bootstrap

Creation of the publisher-owned Notion coordination surface and canonical schema when that surface does not yet exist under the configured target.

Bootstrap includes:

* the `Tasks` data source;
* canonical properties;
* self-relation support;
* the canonical task-page content structure.

Bootstrap is supported.

Automatic migration of an incompatible existing schema is not.

## Decisions

### Implementation Language

Implement the publisher in TypeScript on Node.js.

Use the official Notion JavaScript client for Notion API access.

Keep dependencies small. A schema-validation library may be used for configuration and environment validation.

### Execution Location

The publisher is not limited to repository-local execution.

The following kinds of execution must be possible:

```text
tool checkout
    |
    | plan path
    | config path
    v
publisher
    |
    v
Notion
```

and:

```text
isolated worktree A
    |
    | plan artifact
    v
publisher located elsewhere
    |
    v
Notion
```

The publisher must not implicitly assume that:

* the current working directory is the target repository root;
* `PLAN.md` is located beside the publisher;
* publication configuration is inside the publisher source tree;
* the plan artifact is inside the publisher source tree.

Required paths must be resolved through explicit CLI arguments or explicit configuration.

### Execution Model

The publisher is a local CLI.

Its primary invocation must accept at least an explicit plan path and configuration path, for example:

```text
plan-publish \
  --plan /path/to/docs/plans/active/2026-09-05-example.md \
  --config /path/to/publisher-config.yaml
```

The exact CLI syntax may be kept simple, but plan and configuration resolution must not depend on a particular current working directory.

The CLI performs publication synchronously and exits with a clear success or failure result.

No agent is involved in publication.

### Publication Mapping

One plan artifact creates one coordination task record.

The complete plan Markdown is copied into the task's immutable Plan section without semantic rewriting.

Other task fields are produced mechanically from the canonical policy, configuration, or deterministic plan metadata.

The publisher also creates an empty mutable Workpad section.

The publisher must not:

* summarize the plan;
* extract new implementation tasks from the plan;
* split one plan into multiple tasks;
* invent dependencies;
* infer rationale or tradeoffs;
* alter planning decisions;
* pre-populate the Workpad with inferred execution content.

### Symphony Compatibility Contract

Inspect the tracker-facing contract of upstream Symphony before fixing the Notion schema and publication mapping.

Do not treat upstream Symphony as merely an illustrative implementation.

For this work, upstream Symphony is the basis for determining:

* which issue fields are actually required or consumed by the execution path;
* which fields affect dispatchability;
* which issue data is passed into worker context;
* how blockers are represented and interpreted;
* how state values are used for active and terminal handling;
* how priority and labels are consumed.

Use that evidence to fix the structured canonical fields of the Notion coordination surface.

The goal is not to reproduce the Linear schema.

The goal is to make the following transformation explicit and lossless:

```text
Notion coordination record
        ↓
tracker / coordination adapter
        ↓
Symphony canonical issue
        ↓
Symphony workflow
```

Do not require the adapter to interpret plan prose or Notion-specific layout in order to reconstruct missing structured semantics.

The coordination surface may contain additional execution surfaces, such as Workpad, that are not part of upstream Symphony's tracker issue model.

### Exact Notion Coordination Schema

Create one publisher-owned Notion data source named:

```text
Tasks
```

The schema is fixed as follows.

| Property      | Notion type        |       Required | Mapping / purpose                             |
| ------------- | ------------------ | -------------: | --------------------------------------------- |
| `Title`       | `title`            |            yes | `issue.title`                                 |
| `Identifier`  | `rich_text`        |            yes | `issue.identifier`; duplicate-publication key |
| `State`       | `select`           |            yes | `issue.state`                                 |
| `Priority`    | `number`           |             no | `issue.priority`                              |
| `Labels`      | `multi_select`     |             no | `issue.labels`                                |
| `Blocked By`  | self `relation`    |             no | `issue.blocked_by`                            |
| `Plan Source` | `url`              |             no | publication provenance                        |
| `Created`     | `created_time`     | yes, automatic | `issue.created_at`                            |
| `Updated`     | `last_edited_time` | yes, automatic | `issue.updated_at`                            |

The Notion page ID itself is the stable internal issue identity:

```text
issue.id = notion_page.id
```

Do not create a separate `ID` property.

Do not create a separate `Description` property.

The immutable Plan section in the task page body maps to:

```text
issue.description = Plan section content
```

### Title

`Title` is the single required Notion `title` property.

Its value is derived deterministically from the plan heading.

For a plan such as:

```text
# 2026-09-05-notion-plan-publisher
```

the task title may be normalized to:

```text
Notion plan publisher
```

The exact normalization rule must be deterministic and tested.

If a required title cannot be derived deterministically, publication fails.

### Identifier

`Identifier` is a `rich_text` property.

It is the canonical human-readable identifier used for logs, task references, and duplicate detection.

Derive it deterministically from the plan filename without the `.md` extension.

Example:

```text
docs/plans/active/2026-09-05-notion-plan-publisher.md
```

produces:

```text
2026-09-05-notion-plan-publisher
```

The publisher must reject publication when another task already has the same `Identifier`.

The publisher does not generate random identifiers.

### State

`State` is a Notion `select` property.

The canonical initial option is:

```text
Todo
```

The canonical policy defines these known values:

```text
Todo
In Progress
Human Review
Rework
Merging
Done
Cancelled
Duplicate
```

The exact active and terminal interpretation remains execution configuration owned by the Symphony workflow.

The publisher creates these known options during bootstrap.

Repository publication configuration may override the initial value but may not change the property type or semantic role of `State`.

### Priority

`Priority` is a Notion `number` property.

Allowed publication values are:

```text
1
2
3
4
null
```

Lower values mean higher execution priority.

When no priority is configured, leave the property empty.

Do not infer priority from plan content.

### Labels

`Labels` is a Notion `multi_select` property.

Normalize values by:

1. trimming surrounding whitespace;
2. converting to lowercase;
3. removing blank values;
4. removing duplicates.

An absent label set is represented as an empty multi-select value.

### Blocked By

`Blocked By` is a self-relation from the `Tasks` data source to the same `Tasks` data source.

Each related page represents one blocker.

The coordination adapter maps each related page to a blocker reference containing at least:

```text
id
identifier
state
```

A task with no blockers has an empty relation.

The publisher must not infer blockers from plan prose.

For initial plan publication, `Blocked By` remains empty unless explicit mechanical publication input provides blocker identifiers.

### Plan Source

`Plan Source` is a Notion `url` property.

When the plan has a stable source URL, such as a GitHub URL, store it here.

When the publisher only receives a local filesystem path and no stable externally meaningful URL is available, leave the property empty.

Do not store `file://` paths or machine-local absolute paths in Notion.

This property is provenance metadata and is not part of the Symphony dispatch contract.

### Created

`Created` is a Notion `created_time` property.

It is managed automatically by Notion.

The publisher never writes it explicitly.

### Updated

`Updated` is a Notion `last_edited_time` property.

It is managed automatically by Notion.

The publisher never writes it explicitly.

### Canonical Task Page Structure

Each task page contains two fixed semantic sections beneath the page properties:

```text
Task Page
├─ Properties
├─ Plan
└─ Workpad
```

The page structure must make Plan and Workpad independently addressable by the coordination implementation.

Do not rely on loose natural-language interpretation to distinguish them.

The implementation should preserve stable block identities or another deterministic structural reference where practical so later tooling can read and update Workpad without scanning arbitrary page text.

### Plan Section

The `Plan` section contains the complete original plan Markdown.

The publisher creates and populates this section during publication.

The Plan section is immutable execution input.

The publisher must preserve the plan without:

* summarization;
* extraction;
* semantic rewriting;
* reordering;
* generated execution commentary.

The coordination adapter exposes this section as:

```text
issue.description
```

Execution tooling must not use Workpad as a substitute for the Plan.

### Workpad Section

The `Workpad` section is created during publication and initially contains no execution content.

It is the mutable execution surface owned by the task.

Execution tooling may update it during work.

The Workpad is intended to preserve information another actor needs to continue or review the task without depending on hidden agent-session context.

Typical contents may include:

```text
Progress
Findings
Verification
Handoff
```

These headings are illustrative and are not required schema unless later execution policy explicitly fixes them.

The publisher itself must not infer or generate Workpad contents from the plan.

The coordination layer should expose the Workpad independently from `issue.description`, for example:

```ts
{
  ...issue,
  workpad: workpadContent
}
```

Workpad is a coordination-specific field and does not need to exist in upstream Symphony's native tracker issue model.

### Canonical Normalized Mapping

A Notion task is normalized for the local coordination path as:

```ts
{
  id: page.id,
  identifier: properties.Identifier,
  title: properties.Title,
  description: planContent,
  workpad: workpadContent,
  priority: properties.Priority ?? null,
  state: properties.State,
  branch_name: null,
  url: page.url,
  labels: properties.Labels,
  blocked_by: relatedPages.map(page => ({
    id: page.id,
    identifier: page.properties.Identifier,
    state: page.properties.State
  })),
  created_at: properties.Created,
  updated_at: properties.Updated
}
```

The Symphony adapter may consume only the subset it requires.

No canonical structured field may require interpretation of arbitrary plan or Workpad prose.

### Fields Intentionally Not Stored

Do not add these properties to the Notion schema:

#### `ID`

The Notion page ID already provides the stable internal identity.

#### `Description`

The Plan section is the description.

#### `Workpad` Property

Do not store Workpad as a `rich_text` database property.

It belongs in the page body as a dedicated mutable content surface.

#### `URL`

The adapter can derive the Notion page URL from the page object.

#### `Branch Name`

The publisher does not know execution branch metadata when the plan is published.

Expose:

```text
issue.branch_name = null
```

unless later execution-side integration has deterministic branch metadata.

#### Explicit Publisher-managed Timestamps

Use Notion's `Created` and `Updated` properties.

### Bootstrap Schema

Bootstrap creates the `Tasks` data source with these canonical properties:

```ts
{
  Title: {
    title: {}
  },

  Identifier: {
    rich_text: {}
  },

  State: {
    select: {
      options: [
        { name: "Todo" },
        { name: "In Progress" },
        { name: "Human Review" },
        { name: "Rework" },
        { name: "Merging" },
        { name: "Done" },
        { name: "Cancelled" },
        { name: "Duplicate" }
      ]
    }
  },

  Priority: {
    number: {}
  },

  Labels: {
    multi_select: {
      options: []
    }
  },

  "Plan Source": {
    url: {}
  },

  Created: {
    created_time: {}
  },

  Updated: {
    last_edited_time: {}
  }
}
```

After the data source exists, add:

```text
Blocked By -> self relation to Tasks
```

Each published task page is then initialized with:

```text
Plan
<complete plan content>

Workpad
<empty>
```

The exact API operation order may depend on Notion IDs returned during bootstrap, but the resulting schema and page structure are fixed.

### Existing Schema Validation

An existing coordination surface is compatible only when all canonical properties exist with the expected semantic types:

```text
Title       -> title
Identifier  -> rich_text
State       -> select
Priority    -> number
Labels      -> multi_select
Blocked By  -> self relation to Tasks
Plan Source -> url
Created     -> created_time
Updated     -> last_edited_time
```

Additional unrelated properties may exist and must be ignored.

For existing task pages, Plan and Workpad must also be structurally discoverable according to the canonical page contract when those pages are used by this coordination implementation.

Missing canonical properties or incompatible canonical property types cause publication to fail with a schema compatibility error.

The publisher does not automatically migrate incompatible canonical properties.

The configured policy may override supported property names, but it may not override canonical property types or semantics in v1.

### Initial State and Other Defaults

Initial state, priority, labels, and similar mechanical publication values are resolved in this order:

1. an explicitly supported publication configuration value;
2. otherwise the canonical policy default.

Do not infer these values from plan prose.

The initial state and state vocabulary must be compatible with the execution behavior expected by the upstream Symphony workflow.

### Publication Configuration

Provide non-secret publisher settings in a separate configuration file.

The configuration does not need to live inside a particular repository.

Its path must be passable explicitly to the CLI.

Configuration should contain only publication concerns, such as:

* target Notion parent page URL;
* initial state;
* default priority;
* default labels;
* supported canonical property-name overrides;
* values needed for duplicate behavior;
* bootstrap surface name.

Support a Notion page URL so the user does not need to manually extract an internal Notion ID.

Keep configuration narrow.

Do not expose arbitrary Notion schema construction through configuration.

### Policy Injection

Implement the canonical schema, page structure, and publication behavior as an explicit policy object rather than scattering assumptions through Notion API code.

Internally, the publisher should receive that policy as a dependency.

Production uses the default Symphony-compatible coordination policy.

Tests may inject alternate policy objects.

Supported configuration may override selected values in the default policy, but canonical field semantics and the Plan/Workpad distinction remain code-owned.

### Pre-execution Credential Provisioning

Before work begins, the user will prepare a temporary `.env` file at the root of the current project directory.

Example:

```text
<project-root>/.env
```

The file must contain the Notion API credential under exactly this environment-variable name:

```text
NOTION_TOKEN=<notion-api-token>
```

For example:

```text
NOTION_TOKEN=secret_xxxxxxxxxxxxxxxxx
```

The executor may assume only that the project-root temporary `.env` contains the credential under `NOTION_TOKEN`. It must not assume any additional secret fields.

This `.env` file is a user-provided execution input for this implementation and verification work.

After creating the isolated implementation worktree, the executor will copy the temporary `.env` from the project root into the worktree root.

```text
project root/.env
        ↓ copy
isolated worktree/.env
        ↓
implementation + live Notion verification
```

The executor does not need to reproduce the token value in chat or in the plan document.

The copied `.env` must:

* remain untracked by Git;
* never be committed;
* never be included in the Pull Request;
* never be copied into source code or fixtures;
* never be exposed in logs, generated configuration, or task contents.

The implementation must support `NOTION_TOKEN` as its runtime credential.

The repository may include a non-secret `.env.example` containing:

```text
NOTION_TOKEN=
```

if useful.

Do not implement OAuth, OS credential storage, secret-manager integration, or multi-user credential handling in this work.

The temporary project-root `.env` is only the credential-delivery mechanism for completing implementation and live E2E verification in one execution. It does not mean that the publisher's long-term runtime location depends on that repository root.

### Secret Runtime Behavior

At runtime, the publisher uses `NOTION_TOKEN` as its Notion API credential.

If `.env` loading is supported, its purpose is only local execution convenience.

Do not make plan/config path resolution depend on the `.env` location.

If `NOTION_TOKEN` is unavailable, empty, or unusable, fail clearly before or at the first authenticated Notion operation as appropriate.

### Notion Target

The configured Notion page is the parent under which the publisher creates or discovers its coordination surface.

On first use, the publisher may create the coordination database/data source and canonical schema beneath that parent.

The user should not need to manually construct all required Notion properties.

### Schema Bootstrap

Support automatic creation of the canonical Notion coordination surface.

When no publisher-owned coordination surface exists under the configured target:

1. create the `Tasks` data source;
2. create the canonical properties;
3. create the `Blocked By` self relation;
4. make the same surface deterministically discoverable on later runs;
5. publish the requested plan using the canonical Plan/Workpad page structure.

Bootstrap must be safe to run repeatedly and must not create unintended duplicate surfaces.

### Schema Migration

Do not implement automatic migration of incompatible existing coordination schemas in this work.

In particular, do not automatically:

* change property types;
* rename ambiguous existing properties;
* rewrite existing records;
* migrate relation structures;
* transform historical values;
* convert arbitrary existing page content into canonical Plan/Workpad sections.

Report the incompatibility instead.

### Duplicate Publication

Publishing the same plan repeatedly must not silently create duplicate executable tasks.

Derive a deterministic publication identity from the plan artifact.

Before creating a task, detect an existing record with the same canonical `Identifier`.

For v1, treat an existing record as a duplicate and fail clearly rather than turning publication into update or synchronization behavior.

### Notion API Errors

Distinguish failures sufficiently for a user or agent to identify the corrective action.

At minimum, make these cases clear:

* missing configuration;
* missing `NOTION_TOKEN`;
* invalid target URL;
* target inaccessible to the integration;
* authentication failure;
* incompatible schema;
* duplicate publication;
* provider/API failure.

Do not hide a known provider failure category behind a generic publication error.

### No Bidirectional Synchronization

The publisher creates coordination records from plan artifacts.

It does not synchronize later changes between the repository plan and Notion.

It does not pull Notion changes back into the plan artifact.

The Workpad is intentionally mutable in Notion, but that mutability is execution coordination and does not imply synchronization back into the plan document.

Future synchronization behavior is outside this plan.

### No OAuth or Multi-user Product Flow

This is a local tool.

Use a host-provided Notion integration token through `NOTION_TOKEN`.

Do not implement OAuth, account onboarding, token storage services, or multi-tenant credential handling.

### Separation from `PLAN.md`

`PLAN.md` remains the instruction surface for the interactive planning process.

Publisher runtime configuration does not need to be embedded in `PLAN.md`.

Keep publication configuration separate because it is consumed by the mechanical publisher after planning is complete.

### Relationship to Symphony

The publisher does not invoke or control Symphony itself.

The publisher materializes a coordination record in Notion that contains both:

* the structured issue surface needed by the Symphony execution path;
* the local coordination-specific Workpad surface.

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
   └─ Workpad
   ↓
Tracker / Coordination Adapter
   ↓
Symphony
   ↓
Worker
```

The publisher needs the tracker-facing Symphony issue contract to define the structured execution fields.

Symphony responsibilities such as workspace lifecycle, concurrency, retry behavior, and Codex execution are outside publisher scope.

Workpad is part of the surrounding coordination contract, not an upstream Symphony tracker requirement.

### Worktree Isolation

Implement this plan in a dedicated isolated worktree.

This does not mean that the publisher itself must run from inside a particular repository.

Worktree isolation is the development method used to separate this implementation from the main working tree and establish the Pull Request boundary.

The worktree must start from the intended current base for `main`.

Keep all implementation, tests, configuration examples, and documentation changes belonging to this plan inside that worktree.

After creating the worktree, copy the user-provided temporary `.env` from the project root to the worktree root so it can be used for live Notion verification.

The copied `.env` must remain untracked.

### Plan Completion

After implementation and verification are complete, move this plan document from `docs/plans/active/` to `docs/plans/completed/` before creating the Pull Request.

Moving the plan to completed is part of the completed repository state.

At the time the Pull Request is created, the plan must no longer remain under `docs/plans/active/`.

Treat the repository state after the plan move as the final state and re-check the diff and verification evidence against that state.

### Pull Request

After implementation and verification, finish the work in this order:

1. confirm that the worktree contains only changes belonging to this plan;
2. complete the required automated tests and live Notion verification;
3. move this plan document from `docs/plans/active/` to `docs/plans/completed/`;
4. inspect the final repository state including the plan move;
5. commit the coherent final implementation;
6. push the implementation branch;
7. open a Pull Request targeting `main`.

Do not merge directly into `main` as part of this work.

At Pull Request creation time, the plan must already exist under `docs/plans/completed/`.

The Pull Request must contain enough verification evidence for an independent reviewer to judge whether the publisher works through its intended path.

## Verification

Verification must show that the publisher can create a complete coordination task in Notion from explicitly provided plan and configuration inputs, independent of execution location.

### Upstream Symphony Contract Verification

Inspect the current tracker-facing behavior of upstream Symphony and demonstrate that the canonical structured policy contains the issue semantics required by the actual execution path.

At minimum, verify:

* required issue identity;
* identifier/title/body use;
* state use;
* active/terminal handling;
* blocker representation and dispatch effect;
* priority/label use.

The mapping from each canonical Notion structured field to these requirements must be traceable in implementation or documentation.

Also verify that Workpad is treated as a local coordination-specific surface rather than incorrectly forcing it into the upstream Symphony tracker contract.

### Execution-location Independence

Verify each of the following:

* run the CLI from a directory other than the publisher source directory;
* use a plan artifact located outside the publisher repository;
* use a configuration file located outside the publisher repository;
* if relative paths are supported, their resolution basis is explicit;
* absolute paths work correctly.

An implementation that succeeds only when the current working directory happens to be the target repository root is not acceptable.

### Configuration Parsing

Demonstrate that:

* valid configuration is accepted;
* the configured Notion page URL is parsed deterministically;
* supported overrides are applied;
* malformed or unsupported configuration fails clearly;
* missing required configuration fails before publication begins.

### Credential Provisioning

Before execution, confirm that the user-provided temporary `.env` exists at the project root and contains:

```text
NOTION_TOKEN=<notion-api-token>
```

After creating the isolated worktree, copy it into the worktree root.

Verify that:

* the publisher in the worktree can read the credential through `NOTION_TOKEN`;
* both the source and copied `.env` remain untracked;
* `.env` contents do not appear in commits or the Pull Request diff;
* the credential value does not appear in logs, fixtures, generated artifacts, or task contents;
* missing or empty `NOTION_TOKEN` fails clearly;
* no additional secret field is required for the intended path.

### Policy Behavior

Using automated tests, demonstrate that:

* the default policy completely defines the structured coordination schema;
* the default policy also defines the canonical Plan/Workpad page structure;
* Notion-specific request construction consumes the policy rather than duplicating schema rules;
* an alternate policy can be injected in tests;
* supported configuration overrides modify only the intended policy values.

### Bootstrap

Against a controlled Notion test target, demonstrate that:

1. the configured parent is accessible;
2. no existing publisher-owned coordination surface is present;
3. the publisher creates the `Tasks` data source;
4. canonical properties are created with the expected types;
5. the `Blocked By` self relation is created;
6. publication continues successfully after bootstrap;
7. the published task contains both a populated Plan section and an empty Workpad section.

Run the bootstrap path again and confirm that the existing compatible surface is reused rather than creating an unintended duplicate surface.

### Existing Surface

Demonstrate that a compatible existing coordination surface is discovered and reused.

Demonstrate that an incompatible required property causes a schema error rather than an automatic mutation.

For task-page structure used by this coordination implementation, demonstrate that Plan and Workpad can be located deterministically without interpreting arbitrary page prose.

### Successful Publication

Publish a representative completed plan artifact and verify in the actual Notion surface that:

* exactly one task record is created;
* the identifier is correct;
* the title is correct;
* the initial state is correct;
* configured/default priority and labels are correct;
* the complete plan is preserved in the Plan section;
* the Workpad section exists and starts empty;
* no additional planning interpretation appears in either section;
* all structured fields required for later conversion into a Symphony-compatible issue are present.

### Workpad Update Path

Using the coordination implementation or a focused test helper, demonstrate that:

* the Workpad can be read independently from the Plan;
* the Workpad can be updated without modifying the Plan;
* a later read returns the updated Workpad content;
* Plan content remains unchanged.

This verification does not require implementing the full future execution workflow if that tool is outside this plan, but the page structure and adapter boundary must prove that independent mutable Workpad access is viable.

### Duplicate Protection

Publish the same plan artifact a second time.

Verify that:

* another task is not created;
* the command exits with an explicit duplicate-publication result.

### Authentication and Permission Failure

Verify at least one controlled failure path using an invalid token or inaccessible target.

The resulting authentication or permission failure must be recognizable.

### CLI Result

Verify that the CLI:

* exits successfully only after confirmed publication;
* returns or prints the created task identity on success;
* uses a non-zero exit status on publication failure;
* provides actionable error output without exposing secrets.

### Automated Tests

Add deterministic automated tests for logic that does not require live Notion access, including:

* configuration validation;
* path resolution;
* URL/identifier parsing;
* policy resolution;
* publication metadata derivation;
* duplicate decision logic;
* Notion request construction;
* schema compatibility checks;
* Plan/Workpad page-structure construction;
* Plan/Workpad structural lookup;
* expected error mapping.

Use fake or injected Notion clients where appropriate so ordinary unit tests do not depend on external network access.

### Intended-path Verification

In addition to unit tests, perform at least one live end-to-end publication using a real Notion integration and a controlled test parent page.

The evidence must show:

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
        ├─ Plan
        └─ Workpad
        ↓
Symphony-compatible issue surface
```

Inspect the resulting record directly in Notion.

### Plan Completion Verification

Before creating the Pull Request, confirm that:

* implementation and required verification are complete;
* the plan document has been removed from `docs/plans/active/`;
* the same plan document exists under `docs/plans/completed/`;
* the moved plan still matches the final implementation state.

### Pull Request Verification

Before opening the Pull Request:

* run the repository's applicable automated checks from the isolated worktree;
* run publisher-specific tests;
* perform live Notion publication verification;
* verify Plan/Workpad separation;
* move the plan document from `docs/plans/active/` to `docs/plans/completed/`;
* inspect the final repository state after the plan move;
* inspect the diff against the intended `main` base;
* confirm that no secret or `.env` content is included.

Only after all of these conditions are satisfied should the Pull Request targeting `main` be created.

## Verification Tools

### Upstream Symphony Source and Specification

Use these to determine the tracker-facing issue contract and the fields consumed by the real execution path.

They define the minimum structured issue surface, not the entire local coordination model.

### Automated Test Runner

Verifies deterministic publisher behavior, policy resolution, configuration handling, path handling, request construction, schema validation, page-structure construction, duplicate handling, and failure mapping without requiring live Notion access.

### TypeScript Type Checker

Verifies type consistency across configuration, policy, canonical task data, Workpad representation, and Notion adapter boundaries.

### Linter / Repository Checks

Verifies that the implementation follows applicable repository static rules and conventions.

### Project-root Temporary `.env`

The user-provided credential input prepared before work begins for live verification.

Its required content is:

```text
NOTION_TOKEN=<notion-api-token>
```

The executor copies it into the isolated worktree root.

The secret itself must never enter Git or the Pull Request.

### Notion Test Parent Page

Provides a controlled real target for bootstrap, schema inspection, successful publication, Workpad verification, duplicate protection, and permission verification.

### Notion API / Official JavaScript Client

Exercises the actual provider path used by the publisher.

### Isolated Git Worktree

Ensures implementation and verification occur without modifying the main working tree and provides a clean branch boundary for the resulting Pull Request.

This is a development-isolation requirement, not a runtime-location requirement for the publisher.

### Git Diff

Confirms that the implementation branch contains only changes required by this plan and that no credentials or unrelated files are present.

### Completed Plan Location

Provides repository evidence that the plan was moved to `docs/plans/completed/` before Pull Request creation.

### Pull Request

Provides the review boundary against `main` and preserves implementation and verification evidence for independent review.
