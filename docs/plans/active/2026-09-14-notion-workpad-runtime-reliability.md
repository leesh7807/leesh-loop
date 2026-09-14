# 2026-09-14-notion-workpad-runtime-reliability

## Objective

Make `notion_task_append_workpad` a reliable append primitive for the canonical Notion Workpad.

Long inputs must respect Notion API limits, preserve the supplied logical text in deterministic order, and report success only when the complete logical append is acknowledged successfully.

Partial or ambiguous provider outcomes must never be reported as complete success.

Preserve the existing dynamic-tool → tracker adapter → Notion API execution path.

This work does not define or enforce transactions between Workpad and State, handoff sequencing, lifecycle semantics, or retry/recovery policy.

## Definitions

**Workpad append**

One invocation of `notion_task_append_workpad` with one logical text input.

One logical append may require multiple Notion rich-text items, blocks, or API requests, but it has one overall result.

**Text chunk**

A deterministic contiguous portion of the supplied Workpad text whose individual Notion `rich_text.text.content` value does not exceed 2,000 characters.

Chunking is transport representation only. It must not discard, summarize, reorder, duplicate, or otherwise alter the supplied textual content.

**Paragraph block**

A Notion paragraph block containing one or more ordered rich-text items belonging to the same logical append.

A new paragraph block must not be created solely because one `text.content` item reached the 2,000-character limit.

**Request batch**

A deterministic ordered group of Workpad blocks sent through one Notion `append block children` request.

Every request batch must stay within applicable Notion request limits, including:

* at most 100 child blocks per request;
* no `rich_text.text.content` value above 2,000 characters;
* total serialized request payload no greater than 500 KB.

**Acknowledged batch**

A request batch for which the Notion client received an explicit successful provider response.

**Complete append**

Every request batch required for the logical append has been acknowledged successfully.

**Partial append**

At least one earlier request batch was acknowledged successfully and a later request did not complete successfully from the client's point of view.

A partial append is not a successful logical append.

**Ambiguous provider outcome**

A mutation request failed at the transport or response layer in a way that does not prove whether Notion durably applied that request.

Examples include connection loss or timeout after the provider may already have accepted the mutation.

An ambiguous outcome must not be interpreted as either confirmed success or confirmed absence of a write.

## Intent

The Workpad is intended to be the durable execution record for Symphony workers, so the primitive used to append to it must have clear and trustworthy write semantics.

Workers should be able to submit realistic execution records without having to manually account for Notion's per-text, block-array, or request-payload limits.

The append primitive should preserve the supplied logical text independently from the transport segmentation required by Notion.

In particular, the 2,000-character rich-text limit is a transport constraint, not a user-authored paragraph boundary. Reaching that limit must not by itself introduce a new paragraph block into the durable Workpad.

The primitive should make a clear distinction between:

* a fully acknowledged logical append;
* a known failure before full completion;
* a provider outcome whose durable effect cannot be determined from the client response.

The primitive itself should not attempt to own higher-level workflow behavior.

State changes are separate Notion mutations. Whether a Workpad record should precede a state transition, what a handoff state means, whether a failed append should be retried, and how lifecycle recovery should work are coordination concerns above this primitive.

Do not turn Workpad reliability into a transaction or lifecycle subsystem.

This work is limited to making the existing Notion append path a dependable building block that higher-level workflow policy can reason about accurately.

## Decisions

### 1. Keep the existing provider boundary

Keep `notion_task_append_workpad` as a provider-native dynamic tool routed through the existing bound tracker adapter and Notion client/API boundary.

Preserve the path:

`Codex dynamic tool → Tracker → Notion.Adapter → Notion.AgentTool → Notion API`

Do not introduce a second direct Notion mutation path, an MCP-specific workaround, a repository-local fallback record, or another Workpad storage surface. The canonical Workpad remains the Notion task page body.

### 2. Treat one tool invocation as one logical append

The caller provides one non-empty logical text input and is not responsible for splitting it around Notion transport limits.

The Notion implementation owns text chunking, rich-text construction, block construction, request batching, and aggregation of provider outcomes into one logical append result.

### 3. Preserve logical text independently from transport segmentation

Split the supplied text into ordered `rich_text.text.content` chunks no longer than 2,000 characters.

Chunking must preserve exact supplied text when rich-text contents are concatenated in order; be deterministic; preserve Unicode code points; add no text not present in the input; and avoid empty trailing chunks at exact boundaries.

Pack consecutive chunks into the same paragraph block whenever provider representation limits allow. Do not create a new paragraph block solely because one rich-text item reached 2,000 characters. Create additional paragraph blocks only when another applicable Notion representation or request limit requires them.

Concatenating every generated `rich_text.text.content` value for the append, in durable order and without block delimiters, must reproduce the supplied input exactly.

### 4. Batch within all applicable Notion request limits

Group generated blocks into deterministic ordered request batches. Every emitted request must satisfy at most 100 child blocks, at most 2,000 characters per text content value, and a serialized request payload no greater than 500 KB.

Measure or conservatively bound serialized request size so a locally valid request cannot exceed the provider limit. Use one request when the complete append fits safely; otherwise send batches sequentially in original input order without changing logical text.

### 5. Success requires complete acknowledgement

Return success only after every required request batch receives an explicit successful provider response. The first non-successful request stops subsequent request batches. A prefix of successful requests is not logical success.

### 6. Preserve provider uncertainty

The result may report earlier explicitly acknowledged batches, but must not claim that the failed request was definitely not written unless the response proves that. A transport error, timeout, lost response, or equivalent mutation failure returns failure, preserves the underlying error, indicates that the failed request's durable effect is unknown, and does not describe an exact final durable prefix.

### 7. Distinguish known and ambiguous failure outcomes

The worker-visible result must distinguish complete success, failure before any batch acknowledgement, failure after one or more acknowledgements, and ambiguous outcome for the failed mutation request where applicable, without requiring arbitrary human-readable string parsing. Stable progress metadata such as acknowledged and total batch counts may be exposed but must not imply the first unacknowledged batch is absent from Notion.

### 8. Do not define retry or recovery policy

Do not add automatic whole-append retry, suffix resume, persisted cursors, transaction logs, mutation idempotency keys, provider-state reconciliation, or lifecycle-specific recovery behavior.

### 9. Preserve task scoping

Keep existing bound-task/data-source scope validation before mutation. Long-input handling must not weaken that the tool can append only to the Notion task bound to the current Symphony session.

### 10. Keep State and lifecycle semantics out of scope

Do not modify `notion_task_set_state`, add Workpad-before-State enforcement, couple Workpad writes to State mutations, add state-transition guards, handoff logic, or lifecycle transaction semantics.

### 11. Keep unrelated runtime policy out of scope

Do not change Codex approval policy, sandbox or MCP approval behavior, runtime permission escalation, tracker polling or scheduling, Publisher behavior, Notion schema or task/Plan binding, or comments behavior.

## Verification

Verify the primitive through the actual worker-facing execution path and deterministic provider-boundary tests.

Demonstrate short and exact-boundary appends; a 2,001-character single-line input without an unnecessary second paragraph; ordered valid rich-text chunking; multiple rich-text items in one paragraph; Unicode across boundaries; exact concatenated logical text preservation; and paragraph boundaries only when another provider representation limit requires them.

Demonstrate multi-request batching with no more than 100 child blocks, no text content over 2,000 characters, and no serialized request over 500 KB; deterministic block/request ordering; and preserved logical text order.

For multi-request appends, verify sequential requests, complete-acknowledgement success, first-request and later-request failures, stop-after-failure, preserved provider details, no false rollback, and no prefix success.

For injected ambiguous transport-style failures, verify failure, explicit ambiguity, optional acknowledged earlier progress, no exact durable prefix claim, and no safe retry suffix claim.

Verify unbound and out-of-scope tasks fail before mutation, and exercise the actual dynamic-tool → Tracker → Notion.Adapter → Notion.AgentTool → request boundary path with a long append.

Run targeted Notion agent-tool, adapter, and dynamic-tool tests; the affected Symphony suite; formatting/static checks; and `git diff --check`. Confirm unchanged task reads, comments, State mutation, task scoping, tracker binding, polling, and normalization behavior.

## Verification Tools

* `symphony/test/symphony_elixir/notion_agent_tool_test.exs` — rich-text chunking, paragraph construction, request batching, limits, success/failure/ambiguity, and scope.
* `symphony/test/symphony_elixir/dynamic_tool_test.exs` — worker-facing dynamic-tool registration and execution through the bound tracker adapter.
* Notion adapter/client tests — binding and provider request behavior.
* Injected `notion_request` boundary — exact request bodies, deterministic order, controlled responses, and ambiguous transport outcomes.
* Serialized request-size assertions — provider payload limit compliance.
* `mix test` — affected and broader Symphony regression coverage.
* formatter/static checks and `git diff --check` — repository consistency and whitespace validation.

## chatgpt-shot review log

