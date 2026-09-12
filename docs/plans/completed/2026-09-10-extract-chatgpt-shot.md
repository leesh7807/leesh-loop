# 2026-09-10-extract-chatgpt-shot

## Objective

Extract `chatgpt-shot` from Leesh Loop into an authoritative standalone local utility. It must be callable by arbitrary local consumers without repository identity, caller `.env`, `.git`, `AGENTS.md`, or Leesh Loop files.

## Accepted boundary

`consumer → chatgpt-shot Service → ChatGPT Web → Notion invocation → completed Result → consumer` remains the result path. The standalone utility owns user configuration, the Chrome profile, runtime discovery, the one loopback HTTP service, and its invocation lifecycle. ChatGPT output is not the canonical result: the terminal Notion Invocation Result remains authoritative.

Configuration is `$XDG_CONFIG_HOME/chatgpt-shot/.env` (or `~/.config/chatgpt-shot/.env`); browser data is `$XDG_DATA_HOME/chatgpt-shot/chrome-profile` (or `~/.local/share/chatgpt-shot/chrome-profile`); discovery is `$XDG_CACHE_HOME/chatgpt-shot/runtime.json` (or `~/.cache/chatgpt-shot/runtime.json`). The service binds only `127.0.0.1` on an OS-selected port, atomically publishes an owner-only discovery record containing PID, endpoint, protocol version, and ephemeral credential, and authenticates every operational HTTP request.

## Migration

1. Remove repository-root resolution and repository-keyed browser/runtime identity while the existing source remains available; verify it from an unrelated directory.
2. Replace the public Unix-socket broker contract with authenticated loopback HTTP operations: health, synchronous submit, and graceful stop. Add idempotent CLI `start`, `status`, `port`, and `stop`; route CLI `submit` over that same HTTP API.
3. Preserve Notion lifecycle, acknowledgement/execution timeout distinction, cancellation, serialization, browser cleanup, and duplicate-submission uncertainty behavior.
4. Verify race convergence, stale discovery recovery, credential rejection, loopback-only listening, concurrent isolation, and graceful ownership handoff for login.
5. Transfer source, tests, package metadata, documentation, and utility guidance to the standalone `chatgpt-shot` repository. Make that repository authoritative; build, test, and smoke it there.
6. Remove `leesh-loop/chatgpt-shot/` and Leesh Loop-only ownership/documentation/ignore assumptions only after standalone verification. Move this plan to `completed/` before review.

## Verification record

Automated verification covers configuration independence, discovery validity, authentication, start races, stale state, concurrent request isolation, and existing Notion/state/timeout/cancellation/serialization/duplicate behavior. A manually authenticated Notion end-to-end submit and browser-loss exercise require the operator's configured credentials and interactive Chrome session; they are recorded separately if unavailable to CI.
