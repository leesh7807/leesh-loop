# 2026-09-12-project-operator-browser-workspace

## Objective

Deliver the initial single-repository Leesh Loop Operator and project browser workspace. The Operator owns configuration, lifecycle serialization, readiness, crash-recoverable owned Symphony runtime state, dispatch authorization, and browser-window lifecycle. It must retain the established Operator-readiness and worker-boundary contracts.

## Definitions

**Operator** is the composition root outside Symphony's worker contract. **Owned component** is the Operator application, Notion publisher, or bundled Symphony integration. **External prerequisite** is a workflow dependency whose installation, credentials, service lifecycle, and persistent state remain external; the default is `chatgpt-shot`. **Runtime state** is non-secret durable state with `none`, `starting`, `provisional`, `committed-disabled`, `running`, or `failed` status. **Dispatch barrier** prevents tracker polling and all normal task-execution effects until durable running authorization is observed. **Dispatch acknowledgement** is runtime-visible evidence that the barrier was released. **Effective runtime configuration** is the canonical workflow, Notion binding, workspace root, worker-interface identity, dashboard/process identity, and other behavior-changing bindings used for reuse comparison.

## Intent

Make Leesh Loop a runnable local project environment without turning externally installed tools into project-owned services or weakening the existing worker, Workpad, lifecycle, Human Review, or independent-review contracts. Keep the custom UI intentionally small and link to the existing Notion and Symphony surfaces.

## Decisions

- Move owned components under `operator/`: `operator/app`, `operator/notion_publisher`, `operator/symphony`, and `operator/external/chatgpt-shot`. Update every repository-owned path consumer; do not vendor the external CLI.
- Store non-secret local project configuration and durable lifecycle state under an Operator state directory. Configuration, rather than `WORKFLOW.md`, is authoritative for workflow path, Notion database URL, Symphony workspace root, repository details, and declared external prerequisites.
- Use one abandoned-owner-recoverable lifecycle lease for `start` and `stop`. Under that lease reconcile incomplete state, validate/reuse only compatible acknowledged `running` state, or converge to `none` before a fresh launch.
- Preserve all current bootstrap readiness behavior before spawning Symphony. The external Operator CLI handles doctor, Service readiness/recovery, and smoke submission; the copied worker client remains submit-only and receives only the prepared discovery/interface bindings.
- Spawn Symphony with a durable ownership record and dispatch disabled. Validate a live PID and its observability endpoint, commit `committed-disabled`, atomically publish `running`, wait for runtime acknowledgement, then open the project window. Pre-authorization failure terminates the owned child and never opens a window.
- Reuse only an alive, observability-verified, acknowledged, configuration-compatible `running` runtime. A live incompatible running runtime requires explicit `stop`; incomplete, failed, dead, or unacknowledged state is cleaned before a fresh start.
- Provide a monochrome local publish page with a large Plan field, Publish action, Notion link, dashboard link, and textual result. Open it with the Notion database and Symphony dashboard in one browser window only after acknowledgement; do not recreate user-closed tabs.

## Verification

1. Repository paths resolve exclusively through `operator/`, and bootstrap still performs workspace, GitHub HTTPS credential, external CLI, Service, smoke-submit, worker-interface, and readiness-file checks before launch.
2. Lifecycle tests cover lock contention/abandoned lease recovery, each durable state, process cleanup, no duplicate runtime, compatible reuse, incompatible-running rejection, and stop convergence.
3. A runnable task cannot be claimed, mutated, or dispatched while provisional or committed-disabled; durable `running` is the first possible authorization and acknowledgement is required for reuse/window opening.
4. Runtime identity checks compare canonical workflow, Notion binding, workspace root, worker interface, process, and dashboard; crashes at each recorded state recover deterministically on later lifecycle action.
5. The intended Operator CLI path starts a project, checks observability/acknowledgement, opens the three tabs, publishes a Plan through the existing publisher, and leaves the external Service untouched on stop.
6. Focused unit/integration tests, `npm test`, applicable Symphony tests, shell syntax checks, `git diff --check`, and an exact-HEAD `chatgpt-shot` independent review pass.

## Verification Tools

- Operator CLI and durable-state inspection: lifecycle transitions, ownership, recovery, configuration compatibility, and browser decisions.
- Symphony observability JSON API and process inspection: dashboard/process identity and dispatch acknowledgement.
- Existing bootstrap plus external `chatgpt-shot doctor`, Service health, and real smoke submit: preserved readiness and ownership boundary.
- Node and Mix test suites with fault injection: barrier, lifecycle lock, failure cleanup, publisher path, and unchanged worker contract.
- Browser opener test seam/manual browser inspection: initial three-tab project window and minimal publish page.
- `git diff --check` and independent exact-HEAD `chatgpt-shot submit` review: artifact integrity and independent finding disposition.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `bc870b99ec0b5167ebc8c5482f6437088528e71c` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: dispatch authorization was externally observable before durable `runtime.json` reached `running`; the configured GitHub HTTPS target was omitted from bootstrap; browser fallback returned before confirming a process spawn.
- Applied commit: pending.
- Verification: pending post-fix Node UI/publisher/Symphony formatting and lifecycle-path checks.
