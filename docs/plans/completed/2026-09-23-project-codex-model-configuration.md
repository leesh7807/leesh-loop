# 2026-09-23-project-codex-model-configuration

## Objective

Allow an Operator Project to optionally select the Codex worker model and reasoning effort in `project.json`. Explicit Project values must control the actual Symphony worker; omitted values must remain governed by Codex defaults.

## Intent

`WORKFLOW.md` currently fixes the model and reasoning effort in `codex.command`, while other Project-specific runtime bindings flow from `project.json` through Operator into Symphony's process environment and are consumed by `WORKFLOW.md`. Model and reasoning effort should use that existing Project configuration path. This moves authority for those two values without changing the worker lifecycle or Codex app-server execution structure.

## Verification Requirements

1. An ordinary Operator Project can independently specify `codex_model` and `codex_reasoning_effort`; each explicit value reaches the Codex worker through the normal Operator → Symphony → `WORKFLOW.md` path. `WORKFLOW.md` contains no fixed model or reasoning value.
2. Either setting may be omitted. Omission remains valid, adds no Codex override for that setting, and lets Codex choose its own configuration.
3. Runtime compatibility distinguishes both the value and the presence or absence of each override, so a live runtime with a different explicit setting is not reused.
4. E2E Project values, when present, are copied into each run-local Operator Project independently; absent values remain absent.
5. Worker lifecycle, prompt, Codex app-server structure, and the meaning of other Project bindings remain unchanged.

## Definitions

- **Project configuration**: Operator's `project.json` and its Project-specific runtime settings.
- **Codex model override**: `codex_model`, set only when a Project chooses to replace Codex's default model.
- **Reasoning effort override**: `codex_reasoning_effort`, set only when a Project chooses to replace Codex's default reasoning effort.
- **Runtime configuration**: Project settings used to start a Symphony runtime and compare it for reuse.
- **Run-local Operator Project**: The `project.json` generated for an E2E run and passed to the ordinary Operator entry point.

## Decisions

1. Add optional `codex_model` and `codex_reasoning_effort` string settings to Operator and E2E Project configuration. They are independent.
2. Operator forwards only explicitly configured values through Symphony's process environment. `WORKFLOW.md` consumes those environment values in its existing `codex.command`; it adds no override argument for an absent value.
3. Remove the currently fixed model and reasoning effort from `WORKFLOW.md`, preserving its command role and `app-server` launch structure.
4. When present, each setting must be a non-empty string. Omission is valid.
5. Include both values and their configured/omitted state in effective runtime compatibility.
6. E2E materialization forwards only fields supplied by the E2E Project. It has no model default, override rule, or workflow variant.
7. Do not maintain a model-name or reasoning-effort allowlist in Operator; Codex remains the validation boundary for supplied values.
8. Update `operator/project.example.json` and Project-configuration documentation to describe optional overrides.
9. Keep task lifecycle, dispatch/readiness, workspace creation, Git target, Notion binding, `chatgpt-shot`, Codex app-server protocol, and Symphony configuration schema unchanged.
10. Keep existing Project loading, runtime identity, and E2E Project materialization responsibilities; add no model-only abstraction or configuration subsystem.

## Verification

1. Run the focused Operator and E2E tests for optional-field validation, forwarding, runtime compatibility, and run-local materialization.
2. Through `node operator/app/leesh-loop.mjs start <project.json>`, observe configured and omitted overrides at the Symphony/Codex launch boundary. Verify the unset item has no `--config` argument and the configured item does.
3. Through `node operator/e2e/cli.mjs run operator/e2e/project.json`, inspect the generated run-local `project.json`; when permitted and reachable, observe the selected values at worker launch without requiring completion of the full E2E lifecycle.
4. Run the applicable existing Operator and Symphony workflow/configuration checks, inspect the full diff for preservation of unrelated behavior, search `WORKFLOW.md` for fixed model/reasoning values, and run `git diff --check`.
5. Submit the exact PR URL and `git rev-parse HEAD` to `chatgpt-shot`; independently validate each finding against that HEAD, fix only evidenced contract violations, and repeat for every changed HEAD until the review returns PASS or no findings. Record each round at the end of this plan.

## Verification Tools

- Operator CLI and runtime state: Project validation, effective identity, startup, and runtime compatibility.
- Symphony/Codex launch observation: effective Codex override arguments through the actual process path.
- E2E CLI and generated run-local `project.json`: selective propagation into the ordinary Operator Project.
- Operator/E2E/Symphony tests, repository search, and Git diff: regression and preservation evidence.
- `chatgpt-shot submit` and `chatgpt-shot jobs`: independent exact-HEAD review results.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `45fae5896bfe8cf7039c034cc3bd57ffa08d65ff` on [PR #52](https://github.com/leesh7807/leesh-loop/pull/52); Job `7999246c-1ffc-4c41-8461-1a59996eaabb`.
- Verdict: `PASS`; Findings: `None.` No findings required acceptance or rejection.
- Applied commits: `5fab229` adds the Project settings; `45fae58` fixes the actual worker launch. The first production E2E attempt exposed that Symphony prefixes `exec` to `codex.command`, so a command beginning with a shell assignment exited with status 2. The command now starts with `env` and invokes the conditional argument construction in `bash -c`.
- Verification: Operator tests 25/25; E2E tests 38/38; Symphony workflow/configuration tests 55/55; `git diff --check` passed. The E2E run `1b8da1d6-fb41-43dd-89a8-eaa636da2cc2` materialized both configured values, started the Codex worker with `--config model=gpt-5.6-luna` and `--config model_reasoning_effort=xhigh`, and completed through authoritative `Done` readback with finalization complete and no remaining run-owned branches or workspace. Runtime compatibility was also rejected through the normal Operator CLI for changed and omitted values.
