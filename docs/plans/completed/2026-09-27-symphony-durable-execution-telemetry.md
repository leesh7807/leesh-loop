# 2026-09-27-symphony-durable-execution-telemetry

## Objective

Production Symphony must preserve structured Worker Execution facts after a worker leaves live `running` state and after a process restart. Production E2E must consume those facts through Symphony's existing observability path instead of becoming an independent authority for Symphony timing or execution history.

## Intent and boundaries

The durable record closes only the information gap in existing production state and accounting. Reuse `Orchestrator`, `Presenter`, and the current observability API where possible; preserve the meaning of current-state `/api/v1/state`, issue, and tracker-input surfaces. A retry or continuation dispatch is a distinct Worker Execution. The diagnostic rotating `symphony.log` remains human-readable and is not a telemetry contract.

Do not make E2E polling, E2E options, or E2E run records prerequisites for telemetry. Do not persist a second canonical copy of values stably available from production state/accounting. Do not make persistence or cleanup a worker success condition. Do not change dispatch, retry, reconciliation, termination, token accounting, workspace safety, or external subsystem ownership.

## Durable history lifecycle

Persist structured execution identity, issue identity, attempt, production start/end and outcome, worker host/workspace, Codex session, turn count, token usage, and runtime to the extent those facts cannot be read reliably from existing production sources after completion/restart. Use an atomic or append-safe representation that cannot corrupt prior history on partial writes. Include the necessary schema versioning.

History has a finite default retention and production cleanup. Reconcile interrupted records against live worker state at startup; stale/incomplete records must not receive a permanent retention exemption. Never evict executions that are actually active. The same production observability responsibility exposes retained history through a structured read path without presenting history as active state.

## E2E consumer

Use `OperatorClient` → production Symphony observability API → `RunEvidenceCollector` → E2E verification/run record. Remove E2E-derived authoritative worker runtime and start/end inference. Preserve E2E observation time as observation time and retain E2E-owned run, lifecycle, workload, hard-cap, cleanup, and external-system evidence. Symphony does not own Notion, GitHub delivery, or chatgpt-shot facts.

## Verification

1. Inventory the existing source and projection for dispatch start, retry attempt, host/workspace, session, turns, token usage, runtime, completion/retry/block outcome, aggregates, and E2E fields; identify only the facts that need durable augmentation.
2. Exercise production Symphony dispatch without E2E instrumentation; read completed executions through structured observability after live state removal and after process restart.
3. Exercise completed-history retention, active-execution protection, interrupted/stale reconciliation, repeated interruption boundedness, and retry identity distinction.
4. Regress current state/API/dashboard and tracker-input semantics; retain log-file behavior and avoid log parsing.
5. Migrate E2E to production telemetry consumption and verify a representative production Operator → Symphony → worker → observability API → E2E evidence flow. E2E observation timestamps remain distinct from production execution time.
6. Run focused and repository validation, inspect final diff against this plan, and record delivery/review evidence in the task Workpad.
