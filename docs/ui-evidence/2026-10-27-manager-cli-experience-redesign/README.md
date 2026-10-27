# Manager and CLI redesign evidence

## Latest direct Loop and Worker continuity evidence

The new `worker-continuity/` record captures the final local source checkout at HEAD `60979699b09ec74e5f1faaf12bb8f34a067d268d` using Runtime `050b74f7e1e1c7cf4af9d572a3f9e983838e076c3787ee1d830821171cc6c59d`. The two JPGs are screenshots taken directly from the actual Chrome Manager UI after Manager reentry; they show the same selected project and the completed Task with both Workpad records. The screenshots are 1217×570 browser pixels.

An isolated XDG profile registered a temporary Git repository through `node bin/leesh-loop.mjs add`, started its Loop, and published the continuity Task from the actual Manager UI. The environment's installed `chatgpt-shot` interface exposes only `submit` and `jobs`, so `skip_external_readiness = true` was set only in this disposable instance. The same real Worker service passed an authenticated loopback health check and smoke Job `878d826a-b1e8-4049-a741-b0cc95990f99` (`completed`, result `READY`). No production readiness setting or UI was changed.

The gated Task first wrote `continuity-phase: before-manager-stop` and waited for an external signal. Before stopping Manager, OS readback confirmed Manager PID `54054`/start ticks `421868`, Loop PID `61800`/start ticks `462641`, and actual Codex Worker PID `62628`/start ticks `465564`; an active `sleep` child showed the Worker was waiting. `node bin/leesh-loop.mjs manager stop` reported `Manager Service stopped. Running Loops and Workers continue independently.` and `Continuing: repository (...)`. While Manager was stopped, its service record was absent and port `45738` refused connections. The same Loop and Codex Worker process identities remained live. Read-only SQLite showed the first Workpad entry and the Task still available in the per-instance Store. Only then was the external signal created; the live Worker added `continuity-phase: after-manager-stop` and set the Task to `Done` while Manager was still unavailable.

`node bin/leesh-loop.mjs list` then restarted Manager and returned the project as `Running`. Authenticated Manager API readback reported the same Loop PID/start identity and Task State `Done`. Reloading the existing Chrome tab reauthenticated successfully, restored the selected project and Task, and rendered both Workpad entries. Sanitized process/API/SQLite readbacks are in `worker-continuity/pre-stop.json`, `manager-down.json`, `worker-progress-while-manager-down.json`, and `manager-reentry.json`.

This direct active-Worker run resolves the earlier reviewability gap that an inactive or failed Loop had been used for Manager stop/reopen evidence. It verifies one isolated Codex Worker task across Manager shutdown and reentry; it does not generalize to every Worker failure or Runtime update scenario.

## Design finding follow-up at PR #122 HEAD `bc32a53b5f26a964c2d5e4c32b2687964417db45`

The latest UI changes make unfinished `Backlog` tasks visible in Work and scope the selected project's Loop status, attention message, and controls out of System. Workpad sequence 28 records direct observation of those states in Chrome at `http://127.0.0.1:45741/` with Runtime `ff1e7e64a2269e0a01c0299e33992fb92abc3f9859d1b012de0ac0170398b41c`. The Work view showed the Backlog heading and Task card without a disclosure; System retained the project selector and shared Runtime/Manager controls without the project Loop status or controls.

That observation did not produce a screenshot file in this repository. The existing saved Manager screenshots in this document were captured from UI source HEADs `60979699` or `7f3098a`, before this Design follow-up; neither set proves the appearance of HEAD `bc32a53`. No synthetic screenshot is used as a substitute. Exact-HEAD visual evidence remains incomplete for independent review.

## Artifact identity for the original Manager captures below

- UI source HEAD: `7f3098a` (`Fix narrow Manager viewport overflow`)
- Active Runtime and Manager Runtime: `0a4af8cf626b3451dea49c8ab706148634299140da3b29c267162e4da9c8a227` (`0.1.0`)
- Isolated profile: `/tmp/manager-review-PLAN1868AE86` (temporary XDG roots)
- Manager URL: `http://127.0.0.1:45432/`
- Browser: Google Chrome through the browser automation extension
- Desktop captures: 1217×519 browser screenshot pixels
- Narrow captures: 320 CSS-pixel viewport; 308 CSS-pixel document content width and screenshot width because the browser reserved scrollbar space

The Runtime was built from the UI source at the listed HEAD. All screenshots with `head-7f3098a` in their names are direct Chrome captures after that Runtime was active. Temporary test data is synthetic and contains no user tasks or credentials.

## Direct browser evidence

- [Projects, desktop](projects-head-7f3098a-desktop.jpg) and [Projects, narrow](projects-head-7f3098a-320px.jpg) show the registered local Git project, its path, upstream, separate Loop data location, state, and the repository registration entry point. This isolated profile had one registered project.
- [Task detail after CLI Manager restart](manager-reopened-task-detail-head-7f3098a.jpg) shows the selected project, its three persisted Backlog tasks, the selected Task detail, and the visible failed-Loop explanation after the browser tab reloaded.
- [Task detail, narrow](task-detail-head-7f3098a-320px.jpg) shows the stacked Work queue and Task detail at the 320 CSS-pixel viewport.
- [Plan publication form](task-publish-head-7f3098a-desktop.jpg) shows the empty Accepted Plan input, Blocked By choices, and State selection before publication.
- [System page, desktop](system-head-7f3098a-desktop.jpg) and [System page, narrow](system-head-7f3098a-320px.jpg) show the global Runtime and Manager context. The visible copy distinguishes Manager Service stop from closing the tab and explains that running Loops and Workers continue independently.

The browser reported `window.innerWidth = 320`, `document.documentElement.clientWidth = 308`, and `scrollWidth = 308` on the narrow Projects, Task, and System pages. Removing the fixed 320-pixel body minimum addressed the previous 12-pixel horizontal overflow caused by the viewport's scrollbar gutter. The narrow pages retained their navigation and task meaning.

[`projects-same-name-desktop.png`](projects-same-name-desktop.png) is an earlier direct Chrome capture from source HEAD `5bc8ef1ca401f788aff3f7e23894f544b3ff5821` and Runtime `f365dd09f747a0b0ddfed0472553a4a7f7787dad58f6d770df64466c75b6fd96`. It shows two projects named `demo` with distinct full repository paths, upstreams, Loop data locations, states, and actions. It predates the narrow-body CSS correction; the correction did not change desktop project identification. Treat it as supporting earlier observation, not a screenshot from HEAD `7f3098a`.

## CLI and service readback

From the actual CLI entry point and isolated profile:

- `node bin/leesh-loop.mjs manager stop` reported `Manager Service stopped. Running Loops and Workers continue independently.` and `No active Loops were running.`
- The Manager service record was absent after shutdown and `curl` to `127.0.0.1:45432` returned connection refused (`HTTP 000`).
- `node bin/leesh-loop.mjs` reopened the Manager and printed `Leesh Loop Manager: http://127.0.0.1:45432`.
- Reloading the existing Chrome tab returned to the registered project and its Task Store. The selected project, three Tasks, selected Task, and Backlog state remained visible. The browser screenshot above records this result. The System page displayed the active and Manager Runtime ID as `0a4af8cf626b`.

An intermediate Runtime update was first attempted from a process namespace that could not verify the old Manager process identity; the CLI refused to signal an unconfirmed process. After confirming by Manager API that the only Loop was failed with no process present, the Manager was stopped through its authenticated local stop endpoint, the port closure was read back, and the CLI reopened it. The final source HEAD was then checked again with the CLI Manager stop/readback/reopen sequence above.

## Earlier failed setup attempts (historical; superseded by the direct run above)

An earlier isolated CLI `start` reported `chatgpt-shot could not resolve its Operator configuration path` because that attempt had no resolvable Operator configuration. It had no active Worker and provided no continuity evidence. The later isolated run above verified the real service separately and exercised an actual Codex Worker; use its newer evidence for the current result.

## Verification boundary

- Directly observed: actual Chrome Projects, Work/Task, Plan publication, and System screens; 320 CSS-pixel layout measurements; CLI Manager stop and reopen both with no active Loop (earlier run) and with an active Codex Worker (latest run); HTTP, process identity, SQLite, and service-record readback; persisted project and Task selection after browser reload.
- Test-verified at UI source HEAD `7f3098a`: `npm run build --prefix operator/ui` succeeded and UI tests passed 70/70.
- Earlier full repository suite at source HEAD `5bc8ef1ca401f788aff3f7e23894f544b3ff5821`: 204 passed, 1 skipped, 0 failed. The CSS correction was then covered by the UI build, UI tests, and direct browser observation above.
- Not exercised: a real external Operator request from the isolated test project. Active Loop/Worker continuation across Manager shutdown and reentry is directly observed in the later `worker-continuity/` record above.

The initial Reviewability Preparation at PR #122 HEAD `9d57653f9c1e48e60d9dcff1f90c15dd2a21071e` returned findings for missing final UI captures and unverified active-Loop continuity. Final captures and the active Worker run above address those evidence gaps. The independent preparation reviewer must assess these artifacts against the exact updated PR HEAD.
