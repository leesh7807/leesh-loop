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
- The CLI surface is exactly `init --notion-database`, `login`, `doctor`, and `submit`.
- `NOTION_TOKEN` is the sole Notion credential name. Initialization writes only
  `NOTION_INVOCATION_DATABASE_ID`, preserving unrelated `.env` entries and never printing the
  token.
- The user creates and supplies an empty Invocation database through its direct Notion database
  URL. On first initialization, `init` confirms it has no invocation pages, configures the required
  schema, reads it back, and persists its ID only after successful verification. A configured
  database is read and schema-validated, never replaced or repaired. `init` never creates a
  database or needs a parent page. Required schema: title `ID`, select `State` (`pending`,
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
