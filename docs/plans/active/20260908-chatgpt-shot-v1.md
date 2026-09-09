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
- The implementation is TypeScript/Node with browser details behind a focused transport boundary.
  A dedicated persistent local browser profile is reused by `login`, `doctor`, and `submit`.
  Manual authentication is performed in a user-controlled system Chrome process; credential entry
  is never automated. `login` is headed and explicitly user-interactive. Normal automation uses a
  broker-owned persistent headed system Chrome without intentional foreground activation.
- To reuse a manually authenticated ChatGPT session across commands, the dedicated Chrome browser
  profile and ChatGPT must both be signed in. The observed working hypothesis is that a guest
  browser profile does not reliably retain the ChatGPT session across separate launches;
  browser-profile sign-in does not authenticate ChatGPT itself.
- Composer presence establishes only page readiness: anonymous ChatGPT pages can expose a composer.
  Authentication preflight instead requires visible logged-in account/profile UI and no visible
  ChatGPT login/sign-up control.
- Google/ChatGPT authentication is performed only in a plain headed system Chrome with the
  dedicated profile, without Playwright, CDP, or debugging transport. `login` first shuts down any
  broker-owned Chrome, waits for the user to close plain Chrome, then may start automation solely
  to verify the saved profile state.
- A broker owns one persistent headed system-Chrome runtime for automation after manual
  authentication. It directly spawns Chrome with the same dedicated `Default` profile and
  `--remote-debugging-pipe`, owns the inherited private CDP file descriptors, and exposes only an
  owner-only Unix-domain socket API. It never opens a raw TCP CDP listener, returns a CDP endpoint,
  or proxies arbitrary CDP commands. A focused direct CDP adapter owns only the inherited pipe and
  the deterministic ChatGPT operations; no automation framework launches Chrome. `submit` reuses
  that background runtime without foreground activation.
- The Unix socket resides in a short, per-UID temporary runtime directory keyed by a repository hash
  (rather than under the repository, avoiding Unix socket pathname limits), is mode `0600`, and
  rejects a peer whose available OS UID does not match the broker owner. The broker is the sole
  process that opens the dedicated profile; invocation tabs are separate and are closed after
  acknowledgment, terminal error, timeout, or cancellation while Chrome itself remains available
  until explicit `shutdown`. A successful `shutdown` response is sent only after the Chrome child
  has exited and released the profile, so `login` can safely take ownership next.
- The runtime base itself is validated as owner-controlled before it is used. Clients validate that
  the broker socket is a socket owned by their OS UID before connecting, preventing a different
  local user from preclaiming a predictable shared-temporary pathname. Broker RPCs and private CDP
  requests have bounded deadlines; cancellation has an independent short exit bound if broker
  cleanup is wedged. Operations that deliberately wait for a fresh ChatGPT composer or shutdown
  use a caller deadline longer than their broker-side bounded wait budget, and a broker shutdown
  has one shared completion promise: every successful response means Chrome has exited and the
  profile is released. Shutdown is idempotent when no broker exists, which is the normal first
  `login` state; a live broker shutdown failure remains an error and prevents profile handoff.
- Each invocation owns a distinct fresh browser page. Browser-sensitive work is broker-owned while
  Notion polling after acknowledgment remains concurrent.
- Browser tab cleanup begins before authentication and Notion invocation creation, so every command
  path that opens a tab releases it even when preflight or invocation creation fails.
- Result serialization preserves nested Markdown list hierarchy with four-space levels and
  deterministically projects Notion tables as valid Markdown, using a synthetic first-row header
  when Notion has none, while preserving column headers and cell text; Notion `to_do` state is
  preserved as a Markdown task list. Any child block of a list item is indented with that list
  context, code fences are longer than every backtick run in their Notion code content, and
  equation expressions are projected as displayed LaTex Markdown.
- Result serialization treats Notion rich text as literal content unless an explicit Notion
  annotation supplies Markdown formatting, escapes Markdown syntax that would alter the source
  block meaning (including literal tildes), and never applies list/table whitespace normalization
  inside fenced code content. Inline code uses a fence and synthetic padding that preserve literal
  edge backticks/whitespace; table-cell pipes are escaped even inside an inline-code span.
  Tables encode rich-text line breaks as `<br>` within a physical Markdown row, links escape both
  parentheses in destinations, and quote descendants retain quote context.
- Once Notion reports `in_progress`, `completed`, or `failed`, acknowledgment is proven and the
  browser inspection path is disabled. A `not_submitted` retry starts one new bounded acknowledgment
  window; the second failure is reported without a third submission. A `submitted` inspection
  likewise ends its expired acknowledgment window as `ACKNOWLEDGMENT_TIMEOUT`, never as a later
  execution timeout.
- The execution timeout begins only when Notion first acknowledges an invocation; time spent in
  the independent pending/acknowledgment window never consumes the task execution budget.
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

## Browser transport decision evidence

- D1 PASS: plain system Chrome with explicit `--user-data-dir=<root>/.chatgpt-shot-profile` and
  `--profile-directory=Default` retained an actual ChatGPT login across a complete Chrome restart.
- D2 PASS: the same actual Profile Path (`.../.chatgpt-shot-profile/Default`) used by direct system
  Chrome with `--remote-debugging-pipe`, no Playwright launch, and no TCP CDP listener had no
  challenge, no visible Login control, an authenticated composer, and successful minimal CDP
  composer interaction.
- Broker E2E PASS: direct system Chrome plus the focused private-pipe adapter passed `doctor` and
  a real `submit` invocation `6ebd27b8-0ed5-441c-8453-45bab0ce7983`. Notion observed
  `pending -> in_progress -> completed`; its canonical page body projected to
  `PRIVATE_PIPE_DIRECT_CDP_FINAL_SMOKE_OK`. No assistant-response extraction or TCP CDP endpoint
  participated in that path.
- Broker lifecycle PASS: after `doctor`, `shutdown` waited for the broker-owned Chrome to exit;
  no broker, dedicated-profile Chrome, or runtime socket remained before a subsequent command.

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
- System Chrome plus a private inherited CDP pipe: plain headed manual login, broker-owned headed
  automation, authentication detection, fresh context, user-turn inspection, tab cleanup, and
  deterministic submission without assistant extraction.
- CLI commands: intended public setup, diagnostics, and one-shot execution paths.
- Notion UI and diagnostic lifecycle logs: independent visibility of database records and state.
