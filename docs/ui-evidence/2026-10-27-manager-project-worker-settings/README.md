# Manager project Worker settings evidence

Captured on 2026-10-27 from the isolated XDG profile and disposable `settings-worker` repository.

## Identity

- Captured source HEAD: `af48112c53ae6d49cef1dd71479f977ea53a8158`.
- Manager Runtime: `443bfe233e4460bd35d9a545fbb7445656996e4b893ec56c4dbf3f2cd01c185a`.
- `inspectRuntimeSource()` for that exact source HEAD returned the same ID as the isolated Manager's active Runtime. The browser settings view was reloaded and captured after this commit; the earlier normal Worker start used the same immutable Runtime ID.
- The active user Manager at port `4320` and its Loop were not changed or stopped.

## Direct browser captures

- `manager-settings-desktop.jpg` — headless Chrome 156.0.8078.47, viewport `1440×1180`.
- `manager-settings-mobile.jpg` — headless Chrome 156.0.8078.47, viewport `390×1000`.
- Both are direct JPEG captures from the production Manager UI served by the isolated Manager at `127.0.0.1:45820`. The browser used the Manager-generated local bootstrap redirect, selected `settings-worker` through the Repositories control, and opened the selected Loop management panel. Chrome's page screenshot API captured the rendered view; no settings write occurred during capture and no synthetic UI image was used.
- The captured Runtime is `443bfe233e4460bd35d9a545fbb7445656996e4b893ec56c4dbf3f2cd01c185a`, installed from source HEAD `af48112c53ae6d49cef1dd71479f977ea53a8158`. That Runtime serves the captured settings UI. The current delivery HEAD additionally contains the evidence and this README update.

## Evidence record

- **Direct observation:** After source HEAD `af48112c53ae6d49cef1dd71479f977ea53a8158` was committed, the actual Manager UI selected `settings-worker`, showed its repository path, and showed `codex_model=gpt-6-luna` with `codex_reasoning_effort` unset. The UI also showed `Stopped`, the Codex-default clear behavior, and the next-start timing. The retained desktop and mobile browser captures are listed below.
- **Direct observation:** The actual CLI read the selected project settings and reported the same model and omitted reasoning override. It independently set and cleared both fields after Manager confirmed `Stopped`; sanitized command/output records are in `settings-cli.txt`.
- **Direct observation:** The authenticated Manager settings API returned `codex_model=gpt-6-luna`, `codex_reasoning_effort=null`, and `canUpdate=false` while the test Loop was running. Authoritative per-instance `project.toml` contained `codex_model = "gpt-6-luna"` and omitted `codex_reasoning_effort`; sanitized readback is in `manager-readback.json`.
- **Direct observation:** Clicking the normal Manager `Retry Loop` control started the isolated project. Linux process readback showed the real `/usr/lib/openai-codex/bin/codex app-server` process with `--config model=gpt-6-luna`, `SYMPHONY_CODEX_MODEL=gpt-6-luna`, and no `SYMPHONY_CODEX_REASONING_EFFORT`. The Manager reported `Running`; process identity and the finished smoke Task are in `worker-readback.json`.
- **Test verification:** `node --test operator/app/test/manager.test.mjs operator/app/test/operator_ui.test.mjs` passed 52/52. Tests cover independent set/clear behavior, atomic project-file replacement, unchanged unrelated configuration and project data, ambiguity rejection, invalid requests, and Running/Unconfirmed process protection.
- **Test verification:** `npm run build --prefix operator/ui` completed successfully.
- **Inference:** The process arguments and environment establish that the new Worker received the configured model and no reasoning-effort override through the normal Manager → Symphony → Codex start path. They do not prove Codex's private internal interpretation beyond the observed launch boundary.
- **Limit:** The isolated project used `skip_external_readiness = true` because the disposable profile lacked the optional `chatgpt-shot` Operator configuration and GitHub CLI readiness. The actual Manager lifecycle and real Codex app-server still ran; this setting does not assert readiness checks passed. It was confined to the isolated test project.

## Files

- `settings-cli.txt` — sanitized actual CLI readback.
- `manager-readback.json` — sanitized Manager API and `project.toml` readback.
- `worker-readback.json` — sanitized process, Manager, and Task Store readback.
- `manager-settings-desktop.jpg` and `manager-settings-mobile.jpg` — direct browser screenshots of the saved project settings view.
