# 20260908-chatgpt-shot-v1

## Objective

Implement `chatgpt-shot`, a local TypeScript one-shot CLI that submits a caller-provided
prompt through a manually authenticated ChatGPT Web session and returns the completed Result
from a Notion-backed invocation record. Its public contract is `submit(prompt) -> response`.

## Definitions

An **Invocation** is one independent execution with a generated UUID, one Notion page, a
canonical `State`, optional `Error`, and a page-body Result. The **Invocation database** is the
dedicated Notion mailbox identified by the user-supplied direct database URL. **Acknowledgment** is an
observed Notion state of `in_progress`, `completed`, or `failed`; browser activity alone is not
acknowledgment. The **Result** is the complete invocation page body, projected deterministically
to Markdown only after `State = completed`.

## Decisions

- All implementation is under `chatgpt-shot/`; root integration is limited to the existing root
  `.env`. Configuration is always resolved from the repository root, never from `process.cwd()`.
- The implementation is TypeScript/Node with Playwright behind a browser transport boundary.
  A dedicated persistent local browser profile is reused by `login`, `doctor`, and `submit`.
  Manual authentication is performed in a user-controlled system Chrome process; credential entry
  is never automated. Deterministic Playwright execution reuses its persistent profile and system
  credential store, remains headed, and does not use a headless runtime because the provider
  challenges it before the authenticated composer is available.
- To reuse a manually authenticated ChatGPT session across commands, the dedicated Chrome browser
  profile and ChatGPT must both be signed in. The observed working hypothesis is that a guest
  browser profile does not reliably retain the ChatGPT session across separate launches;
  browser-profile sign-in does not authenticate ChatGPT itself.
- Authentication preflight requires both an available composer and absence of visible ChatGPT
  login controls; a guest composer is not an authenticated execution environment.
- Browser lifecycle must not repeatedly launch a foreground window that steals the user's focus
  during normal commands. Prefer one locally managed, long-lived runtime that commands reuse in
  the background. If the authentication or browser runtime cannot operate in the background, keep
  one foreground browser window alive and reuse it rather than repeatedly opening and closing it.
  Later commands attach to the same runtime and persistent profile. Implementation must preserve a
  local-only attachment boundary, profile locking, serialized fill/submit interaction where needed,
  and clear recovery when the retained browser is closed.
- The managed runtime publishes only a loopback CDP endpoint and local runtime-state file; CLI
  process exit disconnects from that endpoint but does not close the retained Chrome process.
- A repository-runtime-scoped inter-process lock serializes only fresh-context navigation, prompt
  filling, and submission. Invocation creation and Notion polling remain concurrent; a stale lock
  is recovered only when its recorded owner process is no longer alive.
- Runtime discovery and cold Chrome creation use a separate inter-process lock, preventing two
  commands from attempting to own the same persistent profile during a cold start.
- A newly created lock is not stale merely because its owner file has not yet been written; only a
  recorded dead owner, or an ownerless lock past a bounded initialization grace period, is eligible
  for recovery.
- Each invocation owns a distinct browser tab in the retained runtime, so later commands cannot
  navigate or overwrite an earlier invocation's inspection surface.
- The invocation-owned tab is closed when local invocation handling reaches any terminal, timeout,
  or cancellation exit; closing the CDP client connection still does not close retained Chrome.
- Browser tab cleanup begins before authentication and Notion invocation creation, so every command
  path that opens a tab releases it even when preflight or invocation creation fails.
- Result serialization preserves nested Markdown list hierarchy with four-space levels and
  deterministically projects Notion tables as valid Markdown, using a synthetic first-row header
  when Notion has none, while preserving column headers and cell text.
- Once Notion reports `in_progress`, `completed`, or `failed`, acknowledgment is proven and the
  browser inspection path is disabled. A `not_submitted` retry starts one new bounded acknowledgment
  window; the second failure is reported without a third submission.
- The CLI surface is exactly `init`, `login`, `doctor`, and `submit`.
- Root `.env` is the only Notion configuration surface: it requires `NOTION_TOKEN` and
  `CHATGPT_SHOT_NOTION_DATABASE_URL`. The tool derives the database ID internally, never prints the
  token, and does not mutate `.env`.
- The user creates and supplies an empty Invocation database through
  `CHATGPT_SHOT_NOTION_DATABASE_URL`. On first initialization, `init` confirms it has no invocation
  pages, configures the required schema, and reads it back. A configured database is read and
  schema-validated, never replaced or repaired. `init` never creates a database or needs a parent
  page. Required schema: title `ID`, select `State` (`pending`,
  `in_progress`, `completed`, `failed`), rich-text `Error`, `Created At` created time, and
  `Updated At` last-edited time.
- ChatGPT authentication is always manual. `submit` is non-interactive and preflights browser
  availability and authentication before it creates a pending invocation.
- Each invocation has a fresh ChatGPT context. The wrapped caller prompt directs ChatGPT to mark
  the referenced invocation `in_progress` first, place its complete result in the page body, and
  mark it `completed` last; failures populate `Error` then end in `failed`.
- Assistant UI output is never consumed. Notion is the only canonical result transport.
- Acknowledgment and execution timeouts are distinct. On acknowledgment timeout, inspect only
  the invocation-specific user turn and composer. Retry once only when strongly not submitted;
  never retry an uncertain or already submitted turn. Local timeout/cancellation never mutates
  canonical state.
- Semantic browser fallback recovery is deferred and is not scaffolded in v1.

## Verification

Verify root `.env` resolution from supported directories; init direct-database resolution,
empty-database schema setup, readback, idempotency, and configured-schema rejection; persistent manual
authentication and doctor checks; and the complete
`submit` flow from a pending invocation through Notion acknowledgment, terminal state, body read,
and Markdown return. Unit tests use Notion, browser, and time boundaries to cover state handling,
timeouts, serialization, failure validation, and duplicate prevention. Before PR creation, a real
Notion initialization and authenticated ChatGPT-to-Notion smoke invocation must succeed. Only
then move this plan to `docs/plans/completed/`.

## Verification Tools

- Automated TypeScript tests: deterministic state, timeout, serialization, and retry evidence.
- Notion API: supplied database/page read access, schema and Result readback.
- Playwright: persistent profile, authentication detection, fresh context, user-turn inspection,
  and deterministic submission without assistant extraction.
- CLI commands: intended public setup, diagnostics, and one-shot execution paths.
- Notion UI and diagnostic lifecycle logs: independent visibility of database records and state.
