# Operator task UI evidence

The wide and narrow task captures use the configured production Notion task source through the Operator server. The browser loaded 13 eligible tasks at that readback. The page retained the same task-before-publication order at 1440 px and 375 px; neither width had horizontal overflow. Task page and Accepted Plan links opened Notion in a new tab while the Operator tab stayed open. Browser fetch/resource inspection showed only the local Operator API and assets; the React client made no Notion API request and no Plan or Workpad body request.

Production currently has no `Blocked By` relations. `blocked-by-fixture-wide.png` uses a focused browser fixture to show a blocker by Title and State without exposing a page or relation ID.

`publication-success-wide.png` shows a real submission through the React form, Operator server, and existing Notion Publisher. The Publisher returned `PLAN-5F8133895FBA` with State `Backlog`. Read-only task-surface readback then found that task and its canonical Accepted Plan URL in Notion. Re-submitting the same Plan exercised the existing Publisher duplicate failure path. The wide and narrow failure captures show the Publisher error and preserved Plan/State context.

`refresh-failure-wide.png` is a focused real-browser client path with controlled API responses: it starts from a successful task read, fails the next refresh, attempts publication while refresh is failing, then recovers on a later successful task read. The previous task remained visible, refresh failure was explicit, and Publish stayed enabled. The recovery read replaced the task and blocker State. The actual production set did not contain a blocker to mutate, so the failure/recovery State change used the focused fixture rather than changing an authoritative task.

The checkout does not contain the ignored caller-owned `operator/project.json`, so repository-root `npm start` could not be exercised here; it exits with `missing or invalid project configuration: operator/project.json`. The rendered UI and real publication were exercised through the same Operator `serve` process using a temporary local project config. Startup's one-surface browser behavior is covered by the Operator browser-opening test. Screenshots therefore provide UI and publication evidence, not an end-to-end Symphony startup claim.

## Captures

| File | Review focus |
| --- | --- |
| [`tasks-wide.png`](tasks-wide.png) | Production task list, title/state/blocker hierarchy, metadata, page links, secondary navigation, and adjacent Plan form at wide width. |
| [`tasks-narrow.png`](tasks-narrow.png) | Same information order and available actions at narrow width. |
| [`blocked-by-fixture-wide.png`](blocked-by-fixture-wide.png) | Fixture blocker Title and State presentation. |
| [`publication-success-wide.png`](publication-success-wide.png) | Actual published task result and Notion next action. |
| [`publication-failure-wide.png`](publication-failure-wide.png) | Actual Publisher duplicate error with Plan and State preserved. |
| [`publication-failure-narrow.png`](publication-failure-narrow.png) | Same retryable Publisher failure on narrow width. |
| [`refresh-failure-wide.png`](refresh-failure-wide.png) | Existing task retention and separate refresh/publication outcomes during controlled failure. |
