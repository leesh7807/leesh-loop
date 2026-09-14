# 2026-09-14-operator-runtime-readiness

## Objective

Create an Operator-owned bootstrap boundary that prepares external runtime dependencies before a Symphony worker is dispatched.

Keep authentication, browser/session state, service lifecycle, and persistent external-tool state outside the worker workspace so normal worker execution does not require host-wide write access, secret bootstrap, interactive login, service startup, or runtime permission escalation.

A dispatched worker should be able to assume that required external execution services are already usable through their prepared worker-facing interfaces.

## Definitions

**Operator readiness**

The pre-dispatch state in which required external tools, authentication, service processes, network paths, and persistent runtime state have been validated through the same paths workers will subsequently depend on.

**Worker contract**

The minimal interface exposed to task execution after Operator readiness succeeds.

## Intent

Move host-level setup and persistent external-tool state out of normal worker execution. A worker should only perform repository work, normal authenticated Git/GitHub operations, and the already-prepared `chatgpt-shot submit "<prompt>"` call.

Keep Notion task mutation separate: Leesh Loop task reads/writes use Symphony dynamic tools and the tracker adapter rather than Codex MCP elicitation.

## Decisions

### Workspace root

Configure `$SYMPHONY_WORKSPACE_ROOT` as a dedicated workspace directory outside the canonical repository. The Operator owns this placement; workspace-root selection is not a worker task responsibility.

### GitHub readiness

Keep HTTPS as the canonical GitHub transport. Before dispatch, confirm network reachability, run `gh auth status` with network available, establish the Git credential-helper path with `gh auth setup-git` when needed, and perform a non-mutating authenticated HTTPS Git/GitHub probe that demonstrates the credential path used by worker operations. Public-repository access alone is not sufficient, and `git push --dry-run` is not a generic readiness test.

Missing or invalid authentication fails Operator readiness before dispatch; workers never perform interactive login.

### `chatgpt-shot` boundary

Treat `chatgpt-shot` as a prepared external execution service. The Operator owns installation, authentication, browser/session state, persistent configuration and invocation storage, Service lifecycle, and readiness validation. `doctor`, `start`, login, or repair flows are Operator-side preparation and diagnosis only.

The authoritative check is one real `chatgpt-shot submit` smoke invocation through the normal invocation lifecycle, including Service discovery, local Notion access, browser/session use, ChatGPT execution, Invocation mutation, and completed Result retrieval. The worker-facing contract is:

```sh
chatgpt-shot submit "<prompt>"
```

Workers use the already-running Service and do not depend on `submit` auto-starting or repairing it, nor run `doctor`, `start`, login, browser/session recovery, or profile repair.

### Ownership and failure model

Keep `$XDG_CONFIG_HOME/chatgpt-shot`, `$XDG_DATA_HOME/chatgpt-shot`, `$XDG_CACHE_HOME/chatgpt-shot`, the persistent browser profile, Service lock/socket/runtime discovery state, and Notion credentials used by `chatgpt-shot` outside the worker workspace. Do not add host configuration directories to the worker sandbox to work around XDG failures. Workers receive only access needed to invoke the prepared interface.

Bootstrap/readiness failure is an Operator-level failure. Do not create a tracker lifecycle transition or start a worker merely to diagnose missing credentials, broken browser/session state, stopped or unhealthy Service, or unusable Invocation delivery. Post-dispatch failures remain subject to the normal worker and repository workflow contracts.

### Documentation boundary

Document the ownership boundary as:

```text
Operator
├─ workspace-root placement
├─ GitHub credential readiness
├─ chatgpt-shot installation
├─ chatgpt-shot auth/session/browser lifecycle
├─ chatgpt-shot Service lifecycle
└─ external-service readiness validation

Worker
├─ repository work inside assigned workspace
├─ normal Git/GitHub operations
└─ chatgpt-shot submit "<prompt>"
```

## Verification

Verify through the intended bootstrap and dispatch paths, using representative real-machine states:

1. A valid host GitHub credential is accepted with network access.
2. The authenticated HTTPS credential path used by worker Git/GitHub operations succeeds without interactive login.
3. Invalid GitHub authentication fails bootstrap before dispatch.
4. Bootstrap can start or recover `chatgpt-shot` as needed, after which the Service is already running and healthy/accepting before dispatch.
5. A real Operator-side `chatgpt-shot submit` smoke invocation completes and returns its Result before readiness is declared.
6. A worker subsequently runs `chatgpt-shot submit "<prompt>"` successfully through the already-running Service without writable access to `chatgpt-shot` XDG directories or the browser profile.
7. The worker path does not depend on `submit` auto-starting or repairing the Service.
8. Removing worker workspaces does not remove or corrupt `chatgpt-shot` persistent state.
9. Invalid `chatgpt-shot` auth, browser/session state, Invocation delivery, or Service readiness fails bootstrap before dispatch.
10. Worker sandbox configuration does not add `$HOME`, XDG roots, browser-profile directories, or other Operator-owned persistent state merely to satisfy GitHub or `chatgpt-shot`.
11. Applicable tests and `git diff --check` pass.

## Verification Tools

- Repository inspection and focused unit/integration tests: confirm configuration, ownership, dispatch gating, failure classification, and worker contract behavior.
- `gh auth status`, `gh auth setup-git`, and an authenticated non-mutating HTTPS Git/GitHub probe: confirm the real GitHub credential path.
- `chatgpt-shot doctor`, Service health/readiness, and a real `chatgpt-shot submit` smoke round trip: confirm the prepared external execution service through the worker-facing interface.
- Worker execution in a dedicated workspace with Operator-owned XDG/browser paths made non-writable: confirm separation and already-running Service use.
- `git diff --check`, the repository test suites, and final diff inspection: confirm delivery quality.
- `chatgpt-shot submit` review using the current PR URL and exact HEAD SHA: independently review the designated artifact; validate every finding against the current HEAD before accepting or rejecting it.

## chatgpt-shot review log
