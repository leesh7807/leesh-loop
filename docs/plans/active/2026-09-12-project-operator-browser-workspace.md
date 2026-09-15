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
- Applied commit: `f88327b76921bea3e9fd6c976042fda89bf3ce97`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 2

- Reviewed HEAD: `f88327b76921bea3e9fd6c976042fda89bf3ce97` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: the publish-surface readiness probe used JSON decoding against an HTML response; the configured Symphony command was omitted from effective-runtime compatibility.
- Applied commit: `9520dc36e56b92fc7f1fce2827c7369f05e808d2`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 3

- Reviewed HEAD: `9520dc36e56b92fc7f1fce2827c7369f05e808d2` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: Elixir exposed a string PID while Node compares numeric PIDs and acknowledgement temporary-file construction called an integer function with that string; lock ownership had a post-`mkdir` owner-record race.
- Applied commit: `c2b67c2ccaa78d4a32f6557b37ccd0e7a8f81574`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 4

- Reviewed HEAD: `c2b67c2ccaa78d4a32f6557b37ccd0e7a8f81574` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: durable PID alone can be reused by an unrelated process before recovery/stop; signal operations must verify a startup identity first.
- Applied commit: `3029c64de984eaec966f16f003372c1d0c3ce68a`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 5

- Reviewed HEAD: `3029c64de984eaec966f16f003372c1d0c3ce68a` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: PID start-identity mismatch must clear stale metadata without signaling the unrelated process; lifecycle lease identity must include startup identity to recover PID-reused abandoned locks.
- Applied commit: `2422bceedd6e7c28d2a1c803b09261c545699228`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 6

- Reviewed HEAD: `2422bceedd6e7c28d2a1c803b09261c545699228` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: a stale ownership record could satisfy a file-existence-only child gate before the new PID identity was durable.
- Applied commit: `5b64d77832315e413a5c98d8e906f8b1529f6757`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 7

- Reviewed HEAD: `5b64d77832315e413a5c98d8e906f8b1529f6757` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: a detached untracked Publish UI could survive stop and continue publishing with stale Notion configuration.
- Applied commit: `2c58e56514cee76961db8d28e4644c0f5a323e6e`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 8

- Reviewed HEAD: `2c58e56514cee76961db8d28e4644c0f5a323e6e` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: compatible runtime reuse recreated the three initial tabs after users could have closed them.
- Applied commit: `486c39596547ad41c7214753ee6f3c51194d3afe`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 9

- Reviewed HEAD: `486c39596547ad41c7214753ee6f3c51194d3afe` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: canonicalization occurred before absolute-path validation, making relative workflow/workspace paths valid unexpectedly.
- Applied commit: `8b62e30`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 10

- Reviewed HEAD: `8b62e30` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: the lifecycle directory was not created before acquiring the kernel `flock` lease.
- Applied commit: `61942d2`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 11

- Reviewed HEAD: `61942d2` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: lifecycle lease setup needed its parent directory before the external lock command could create its file.
- Applied commit: `e803db2`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 12

- Reviewed HEAD: `e803db2` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: a Publish UI child could be live before durable UI ownership was recorded.
- Applied commit: `5f2bb1c`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 13

- Reviewed HEAD: `5f2bb1c` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: the UI used the wrong built publisher path and did not safely hand off its startup ownership record.
- Applied commit: `3e0b2d5`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 14

- Reviewed HEAD: `3e0b2d5` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: the parent/child Publish UI ownership handoff could reject the child that the parent had just launched.
- Applied commit: `4456ad9`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 15

- Reviewed HEAD: `4456ad9` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: a fresh checkout could launch the UI before its TypeScript publisher distribution was built.
- Applied commit: `e7d9b79`.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 16

- Reviewed HEAD: `e7d9b794f3d56b2ea01c880e23075fe14646a441` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: compatible reuse did not recover the initial project window after a crash or launch failure before its durable open marker; URL pathname decoding broke repository roots containing spaces.
- Applied commit: current fix commit.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 17

- Reviewed HEAD: `f1238c40753e1a3797dcbe3436330cc1830efe32` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `FINDINGS`.
- Accepted: the 15-second observability wait incorrectly included bootstrap readiness and the smoke submit; reused runtime start did not recover a dead Publish UI when the browser-open marker existed.
- Applied commit: current fix commit.
- Verification: Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.

### Round 18

- Reviewed HEAD: `309900ca66979aa056c79fd0df84d998bbe93a50` on [PR #21](https://github.com/leesh7807/leesh-loop/pull/21).
- Verdict: `None.`
- Accepted/rejected findings: none reported.
- Applied commit: none.
- Verification: independent exact-HEAD review returned `None.`; prior local Node UI test, publisher tests (18/18), Symphony formatter, Node syntax, and `git diff --check` passed.
