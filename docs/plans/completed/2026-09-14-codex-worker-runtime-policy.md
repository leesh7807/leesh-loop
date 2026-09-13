# 2026-09-14-codex-worker-runtime-policy

## Objective

Update the vendored Symphony Codex runtime defaults so a normal coding worker can operate
autonomously inside its resolved workspace without interactive approval.

Allow writes to the worker workspace and its Git metadata, and allow network/socket access required
by normal coding-agent work. Do not grant host-wide filesystem access or runtime permission
escalation.

Align the default policy with the Codex 0.154.0 contract.

## Scope

Limit implementation to `symphony/` runtime policy, tests, and directly affected Symphony
documentation.

Do not change Operator/bootstrap behavior, GitHub credential setup, `chatgpt-shot` ownership,
Notion runtime behavior, workspace-root placement policy, or unrelated timing tests.

## Runtime contract

The default approval policy is the Codex-compatible granular form with every escalation mechanism
disabled:

```yaml
approval_policy:
  granular:
    sandbox_approval: false
    rules: false
    mcp_elicitations: false
    request_permissions: false
    skill_approval: false
```

The default thread sandbox remains:

```yaml
thread_sandbox: workspace-write
```

When `WORKFLOW.md` does not provide an explicit `turn_sandbox_policy`, Symphony constructs the
runtime default after resolving the worker workspace:

```yaml
type: workspaceWrite
writableRoots:
  - <resolved-worker-workspace>
  - <resolved-worker-workspace>/.git
networkAccess: true
excludeTmpdirEnvVar: false
excludeSlashTmp: false
```

`<resolved-worker-workspace>` is runtime state. It is not persisted or derived as static workflow
configuration. `readOnlyAccess` is omitted because it is not part of the Codex 0.154.0 schema.

An explicit workflow `turn_sandbox_policy` replaces the runtime default as a whole and is passed
through unchanged.

## Boundaries

This change does not:

* introduce `runtimeWorkspaceRoots`;
* extend the app-server protocol;
* add `.git` directory-shape preflight logic;
* require an independent clone shape;
* standardize GitHub HTTPS versus SSH transport;
* bootstrap GitHub credentials;
* grant host-wide writable roots;
* move `chatgpt-shot` XDG/session state into the worker sandbox;
* change Notion dynamic-tool semantics;
* change Workpad serialization;
* modify the unrelated timing-boundary test.

## Evidence

Under the old defaults, direct Codex sandbox probes showed that workspace source files were
writable while `.git` metadata was read-only. `git switch -c` failed while trying to create
`.git/refs/heads/...`. Network-disabled probes also rejected loopback TCP and Unix socket creation,
and the affected Mix test failed in `Mix.Sync.PubSub.subscribe/1` with `:eperm`.

With the target policy, the live Symphony app-server path completed a disposable worker run using
Codex `0.154.0`. The worker successfully:

* created branch `codex/live-runtime-policy-verification`;
* edited `runtime-policy-probe.txt`;
* staged and committed the change as `4dd31a434da2ede2e5bb4bbea8654d7f6d67c655`;
* bound an ephemeral loopback TCP socket;
* bound and cleaned up a Unix-domain socket;
* completed `GH_PROMPT_DISABLED=1 gh auth status --hostname github.com` with exit `0`;
* completed `git ls-remote https://github.com/leesh7807/leesh-loop.git HEAD` with exit `0`;
* received a read-only-filesystem error when attempting to write outside the worker workspace.

The outside probe left no file behind. The actual Symphony call returned `:turn_completed` without
an interactive permission request.

## Implementation

The existing workspace-resolution boundary constructs the default policy with the resolved worker
workspace and its `.git` directory. The implementation updates the Codex schema default, the
runtime policy helper, test fixtures, app-server/config expectations, and directly affected
Symphony README documentation.

## Verification

The following repository checks passed:

* affected workspace and app-server tests: `73 tests, 0 failures`;
* changed live-payload core test: `1 test, 0 failures`;
* formatter check for changed files;
* `git diff --check`.

The full core test suite remains affected by one pre-existing timing-boundary assertion in
`CoreTest`; it was intentionally not modified as part of this plan.
