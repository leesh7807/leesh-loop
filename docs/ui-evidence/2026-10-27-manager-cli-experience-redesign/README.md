# Manager and CLI redesign evidence

## Artifact identity

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

## Loop-start limit

The actual CLI `start` command reached the isolated project and reported `Loop Starting on port 45500`. The subsequent `list` and Manager API readback showed `Failed`, `process_absence_confirmed: true`, and the setup cause: `chatgpt-shot could not resolve its Operator configuration path`. The isolated XDG profile intentionally contained no Operator credentials. No real user credentials were copied into it, and no dummy Worker was substituted. Therefore Manager stop/reopen and Task Store continuity are directly observed, but continuity of an actively processing Loop or Worker was not exercised.

The Manager/browser stop flow does not claim Worker continuity. Active Loop continuity after Manager stop remains unverified and requires an isolated profile with an authorized real Operator configuration before that verification can run.

## Verification boundary

- Directly observed: actual Chrome Projects, Work/Task, Plan publication, and System screens; 320 CSS-pixel layout measurements; CLI Manager stop and reopen; HTTP and service-record readback; persisted project and Task selection after browser reload.
- Test-verified at UI source HEAD `7f3098a`: `npm run build --prefix operator/ui` succeeded and UI tests passed 70/70.
- Earlier full repository suite at source HEAD `5bc8ef1ca401f788aff3f7e23894f544b3ff5821`: 204 passed, 1 skipped, 0 failed. The CSS correction was then covered by the UI build, UI tests, and direct browser observation above.
- Not exercised: an active Loop/Worker during Manager shutdown or restart; a real external Operator request from the isolated test project.

The initial Reviewability Preparation at PR #122 HEAD `9d57653f9c1e48e60d9dcff1f90c15dd2a21071e` returned findings for missing final UI captures and unverified active-Loop continuity. The final captures above address the missing visual evidence. The active-Loop limitation remains explicit and must be reassessed by the independent preparation reviewer for the new delivery HEAD.
