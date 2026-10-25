# Manager and Loop lifecycle review

## Evidence identity

- Review date: 2026-10-26.
- UI source: the working tree for `codex/PLAN-48A60DE7-E4A7-4825-9C7A-3949DCC18CF2`.
- Manager source checkout: `/home/lees/.leesh-loop/workspaces/PLAN-48A60DE7-E4A7-4825-9C7A-3949DCC18CF2`.
- Isolated Manager Runtime snapshot: `9ca8676dc92b95ec481dcb786b9d37857fbeec7838fef158b8305006704e431d` (`0.1.0`).
- Environment: temporary XDG roots under `/tmp/leesh-loop-manager-ux-plan48-dqsIjy`; Manager bound to `127.0.0.1:4349`.
- Repositories: locally created `repo-alpha` (`a5f85ea1c9dc738d8a68d56a7b45a9e47bbd4be8`) and `repo-beta` (`b2e2e3f1a0f35df7caaa74311e5c0b40a87c24da`). Their GitHub-shaped upstream URLs and remote-tracking refs were local metadata for this test; neither repository was cloned from GitHub or pushed.

The browser rendered the built Operator UI against the actual Manager Service, authenticated API, Git repositories, and SQLite Task Stores. The Runtime snapshot was materialized from the current tracked source and the built UI bundle. Its normal Symphony dependency compilation was skipped because `cmake` is unavailable; no Loop process was started. The browser screenshots were directly inspected during the review but this browser interface did not expose a local screenshot export path. This record therefore preserves the observed interaction sequence and authoritative readbacks, not screenshot files or synthetic captures.

## Direct browser observations

1. The initial Manager page explained that adding a repository creates a separate Workflow, Task Store, and workspace under Leesh Loop data while leaving the Git repository unchanged. With two Loops registered, the Repositories disclosure showed the selected Loop and both `Stopped` states. The selected repository path and lifecycle action stayed in the header; Tasks and Plan publication appeared before the collapsed `Manage current Loop` section.
2. Adding `repo-alpha` succeeded and selected it. The success message named the separate Workflow, Task Store, and workspace. Submitting the same repository again produced an alert that it was already managed and included its instance ID; the existing selection remained. Submitting `/tmp/leesh-loop-manager-ux-plan48-dqsIjy/not-a-repository` produced the actionable message `run leesh-loop init from inside a Git repository`; `repo-beta` remained selected and managed.
3. A temporary Backlog task was published in `repo-alpha` through the Operator form: `PLAN-0A522A66-5D2D-4A61-B2EC-8C97BABFB397` (Task ID `0229caea-9d62-41ee-8b8f-b84173754b97`). Its saved state appeared as `Backlog`. Switching to `repo-beta` showed an empty Task queue; returning to `repo-alpha` showed its task. The selected Loop header continued to show `Stopped`.
4. A temporary marker added to alpha's Workflow produced the real Workflow comparison UI with `Update available`, a visible removed line, and the `Apply Workflow Update` action. The browser presented a JavaScript confirmation, but its confirmation control could not be completed through the browser automation interface. The same authenticated Manager `PUT /api/v1/instances/<id>/workflow` operation was then submitted with the comparison's `expectedCurrent`, `expectedCandidateDigest`, and `confirm: true`. It returned HTTP 200 and a backup path. A subsequent Manager API read returned `changed: false`, and the UI rendered `Current` / `This Workflow matches the current template.` The apply is therefore API-verified and visible on reload, not a completed browser-confirmation interaction.
5. The expanded management section explained that the active Runtime is for new starts, running Loops keep their pinned Runtime, and Workflow changes use a separate action. It displayed source checkout version, identity prefix, and path separately from Manager and selected Loop versions. The Runtime action reported `Runtime is already up to date at version 0.1.0. No running Loop or Workflow was changed.` after the real Runtime worker completed.
6. A `390×844` CSS viewport was inspected at device scale factor `1.25` (the browser viewport override was `488×1055`). The header, repository switcher, Task queue, publication form, and management disclosure stacked vertically; the measured document width was `378px` for a `390px` viewport with `scrollX: 0`. At the earlier `312px` CSS width, the repository's existing `320px` body minimum caused an 8px horizontal overflow; that was below the requested narrow review size and was not present at 390 CSS pixels.

## Authoritative readback

- Duplicate registration left the registry at one alpha instance; successful second registration increased it to two.
- The temporary Task Store contained one alpha task and zero beta tasks after switching. API reads for each selected instance returned the corresponding isolated list.
- After unregistration, `DELETE /api/v1/instances/<alpha-id>` returned HTTP 200 with `repository_preserved: true` and `data_preserved: true`. The Manager registry contained only `repo-beta` (`Stopped`); Task API access to the removed ID returned 404.
- After unregistration, alpha's Git working tree remained clean. Its `WORKFLOW.md`, `project.toml`, SQLite Task Store, and workflow backup remained on disk. Opening the preserved SQLite Store directly returned the same Backlog Task ID and identifier. Beta's status and empty Task Store were unchanged.
- A fresh Chrome tab opened after unregistration selected `repo-beta`, displayed `1 managed Loop`, and showed `0` Tasks with the empty-state message.

The browser's JavaScript confirmation could not be accepted through the connected control, so the Workflow apply and unregistration endpoint operations were completed through the same authenticated local Manager API, then read back from the API, disk, SQLite, and a fresh browser tab. The repository, persistence, and final Manager UI outcomes are observed; those two confirmations were not completed through browser clicks.

## Runtime failure and recovery evidence

The first authenticated UI attempt to install the source Runtime returned HTTP 500 with `Invalid URL`. The Runtime worker imports `runtime-distribution.mjs`, whose transitive imports include CLI entry-point guards. Eval workers use `process.argv[1] === "[worker eval]"`; parsing that marker by prefixing `file://` throws `TypeError: Invalid URL` before installation begins. `git-target.mjs` had the same guard pattern. Both guards now compare `pathToFileURL(...)` with `import.meta.url`. The focused worker test imports the real Runtime module from the eval worker and passes.

After that fix, the isolated Manager was restarted from a source snapshot matching the checkout and the Runtime worker completed the no-change update path. A later isolated CLI run also completed a full source Runtime install and activation (`50c66a6830402ec5361286204ac2f04d36955141c415a59ac6dde73e127e666e`) and started the Manager. No Loop process was started. The separate `mix test` attempt still failed while building the Lexbor NIF because `/bin/sh: cmake: command not found`; Local E2E also remained blocked during Symphony startup. No running user Manager or Loop was stopped or changed.

## Evidence limits

- The repositories and Task were temporary local data; the GitHub-shaped URLs are illustrative metadata, not external GitHub repositories.
- No Loop process was started, so live `Running`, readiness, stop, and process-owned unregister behavior rely on the focused Manager lifecycle tests rather than this browser session.
- Browser confirmation behavior for Workflow apply and unregistration is not directly verified because the connected browser control timed out while accepting JavaScript dialogs. Their service outcomes and persistence effects were verified through the real local Manager and authoritative readback.
- Local E2E was attempted twice and failed during Symphony startup before Worker dispatch. Run `aded4033-5e97-441f-959b-9f597ecd748b` timed out while compiling `date_time_parser`; retry `f0caaffc-5647-4038-a8a4-23ffbce69348` reported the Mix build lock held by process 92 and timed out waiting for the state API. Logs remain under `/tmp/leesh-loop-local-e2e-ZuRUT0/` and `/tmp/leesh-loop-local-e2e-wIOzOf/`.
- Screenshots were visually inspected in Chrome during the task but are not stored here; the evidence is the direct interaction record and API/filesystem/SQLite observations above.

## Reviewability Preparation follow-up

The independent Reviewability Preparation for PR #121 at `9a760f4d3730cd24ba07180f1bb386f147e64808` returned `FINDINGS` (Job `fdedbda2-0423-432c-8466-8e105e9eb743`). The reviewer identified three evidence gaps: no preserved visual representation of the final desktop/narrow Manager hierarchy and abnormal state; no changed-Runtime handoff state sequence; and no self-managed source/recovery example. These are reviewability findings, not claims that the implementation is incorrect.

### Visual design fixtures

[`manager-desktop-synthetic.svg`](manager-desktop-synthetic.svg) and [`manager-narrow-synthetic.svg`](manager-narrow-synthetic.svg) reconstruct the final Task-first hierarchy, repository disclosure, management area, Runtime identity labels, and an alternate Unconfirmed state. They are explicitly synthetic vector fixtures based on the Manager JSX/CSS. Repository names, tasks, version labels, and IDs are illustrative; these are not browser captures or live user data. The final Runtime identity labels were added after the earlier direct browser session, so their visible relationship is represented here synthetically and is also covered by UI tests and the production build.

The browser security gate rejected the local `file://` bootstrap URL used while attempting to capture the final review state and explicitly prohibited serving that same page through another browser route. No alternate browser path was attempted. These SVGs are the reviewable offline substitute; they should not be read as direct observation.

### Changed-Runtime handoff

[`runtime-handoff-synthetic.md`](runtime-handoff-synthetic.md) and its embedded SVG show a synthetic before/after sequence using two different immutable Runtime IDs with the same `0.1.0` package version. The fixture carries the expected Runtime update response fields, restart-needed message, post-CLI Manager identity, and an existing Loop remaining pinned to its prior ID. It is illustrative only; this environment did not install a changed Runtime while a Loop was running. The no-change Runtime path remains the direct Manager/API observation above.

### leesh-loop self-management and independent CLI recovery

An additional isolated XDG run used source checkout `/home/lees/.leesh-loop/workspaces/PLAN-48A60DE7-E4A7-4825-9C7A-3949DCC18CF2`, Manager port `4391`, and roots under `/tmp/leesh-loop-reviewability-plan48-lXLIaV`.

1. `node bin/leesh-loop.mjs update` installed and activated Runtime `0.1.0`, ID `50c66a6830402ec5361286204ac2f04d36955141c415a59ac6dde73e127e666e`, from the source checkout and started the Manager. The recorded Runtime source path was the checkout; its source identity and active Runtime ID matched.
2. `node bin/leesh-loop.mjs init` registered the same source checkout as ordinary Loop instance `b59068c2-29ba-4d58-a433-64e479c6c478`, with its project, Workflow, and Task Store under the isolated data root. The source repository remained intact. `node bin/leesh-loop.mjs list` read it as `Stopped` at the source checkout path.
3. Before the recovery read, `ps -eo pid,args | rg '[m]anager\.mjs serve'` returned no Manager process and an unauthenticated status probe to `http://127.0.0.1:4391/api/v1/manager` failed to connect (`http_code=000`). The persisted registry still contained the same instance ID, and `active-runtime.json` still pointed to the recorded distribution.
4. Running `node bin/leesh-loop.mjs list` again from the source checkout returned the same instance ID and `Stopped` state. `manager/service.json` changed from the preceding service record (`started_at` `2026-10-25T16:27:33.676Z`, `process_start_ticks` `22200857`) to a new service record (`started_at` `2026-10-25T16:28:06.311Z`, `process_start_ticks` `22204120`) at the same isolated port and Runtime path. This is an observed CLI-driven Manager restart and registry readback after the Manager was unreachable.

No Loop process was started and no Task was dispatched. The container execution environment reaps detached child processes at command boundaries, so the isolated Manager could not be kept reachable between shell commands; the CLI's successful registry readback occurred within its invocation, and a separate foreground Manager was later stopped explicitly. This verifies ordinary source-checkout registration and a Manager-unavailable recovery entry point, but not recovery from a damaged Runtime distribution or live Loop preservation across a Runtime change.

## Runtime identity follow-up

During review, the browser evidence exposed that showing only `0.1.0` for the active Runtime, Manager service, and selected Loop could conceal that these are different immutable distributions. The implementation now renders each distribution's version together with a 12-character identity prefix and retains the full ID as a tooltip. This final label change is covered by three UI tests and the production Vite build. The browser observations above came from the immediately preceding built snapshot, before the identity-prefix follow-up; the final labels were not re-captured in a browser. Thus, the source checkout versus installed Runtime distinction was directly browsed, while the final active/Manager/Loop ID labels are test-verified and build-verified.

## Behavior review findings follow-up

The independent Behavior review for PR #121 at `2e1c6858dec787bbb1336675ea5bc97c3d8610ee` returned two material findings. The fixes below are implemented in the current working tree and require a fresh independent review against the next exact PR head.

1. **Failed Loop unregistration:** Manager now permits registry-only unregistration when status is `Stopped` or is `Failed` with `can_update_workflow: true`, the existing lifecycle signal that confirms process absence. A recorded live launcher, `Unconfirmed`, and Failed without that signal remain blocked. The UI enables the control only for those same eligible states and confirms whether the Loop is stopped or failed with no active process. Its help text repeats that Git, Workflow, Task Store, and workspace data stay on disk. The focused Manager integration test observed `Starting` rejected, `Failed` with the test process recorded as launcher rejected without `can_update_workflow`, and `Failed` with no process identity returned `can_update_workflow: true` and unregistered successfully. The same test read the registry, Git repository, Workflow, SQLite Task Store, and second instance afterward; retained data and the other instance remained intact. UI eligibility tests cover Stopped, confirmed process-absent Failed, process-owned/uncertain Failed, Unconfirmed, and Starting.
2. **Runtime in an empty Manager:** the shared Runtime panel is now a Manager-level disclosure shown and open when no Loop is selected. It presents the source, active Runtime, Manager identity, and a global install action; selected-Loop Workflow and log controls remain under `Manage current Loop`. An integration test with an empty registry read `/api/v1/runtime`, confirmed source identity and null active/Manager identities, then invoked the global install route and confirmed its restart-required response while the registry remained empty. UI source regression checks verify that this panel is rendered in the no-selection branch.

[`manager-failed-unregister-synthetic.svg`](manager-failed-unregister-synthetic.svg) and [`manager-empty-runtime-synthetic.svg`](manager-empty-runtime-synthetic.svg) show these new states for visual review. Both are explicit synthetic reconstructions from the JSX and CSS; neither is a browser capture. Direct browser review of the modified UI was not available: the local file URL bootstrap had been rejected by the browser security policy, which prohibited serving it through another browser route. The lifecycle and empty-registry results above are test-verified; the rendered appearances remain synthetic and await direct browser review if a permitted capture path becomes available.

## Failed-state recovery navigation follow-up

The Design review for PR #121 at `c8a018c26d40e85f5e555aecab03ee15cfb7b8d1` returned one material finding: the Failed-state guidance recommended Logs or Workflow review while the primary lifecycle action remained Start and the relevant controls lived below the Task workspace in a closed disclosure. The implementation now makes header-level `Review failure` the primary action and `Retry Loop` secondary. `Review failure` opens the Manager panel and Loop logs, scrolls to the Logs section, and focuses its summary. The Task-first layout remains in place for the normal flow; the new action gives Failed instances a direct route to the advised diagnostic action. Workflow and eligible Unregister controls remain alongside Logs in the open Manager section.

[`manager-failed-recovery-path-synthetic.svg`](manager-failed-recovery-path-synthetic.svg) shows the full page order and the direct recovery route, including the Task workspace between the header action and Manager controls. It is a synthetic flow map, not a browser capture. Current browser policy still prevents recapturing the final UI; source regression tests and a production build are the available verification for the new interaction.

## Unconfirmed ownership recovery follow-up

The Design re-review for PR #121 at `1964f7ce941da021dd676d6b3e571e1dad95b659` confirmed the earlier Failed-state D1 was resolved and returned a new material D2: the `Unconfirmed` state blocked lifecycle actions but left diagnosis and Logs behind collapsed controls with no clear next step. The UI now exposes `Review ownership` in the header, removes the inert Start action for `Unconfirmed`, and says to review diagnosis and Loop logs and verify which process owns the assigned port before retrying. Start, Stop, and Unregister remain unavailable until Manager confirms ownership.

Selecting `Review ownership` expands the diagnosis and Manager/Logs panels. It scrolls to and focuses the diagnosis summary, where the raw current status detail and `Open Loop logs` link are visible. Logs and diagnosis are the only newly exposed read paths; the lifecycle authorization and process ownership gates are unchanged. The helper regression test now maps `Unconfirmed` to no lifecycle action, and the UI source check verifies the review control, diagnosis/log expansion, destination focus/scroll, and safe guidance.

[`manager-unconfirmed-recovery-synthetic.svg`](manager-unconfirmed-recovery-synthetic.svg) shows the full Task-first page order, primary ownership review, expanded diagnosis, direct Logs link, and disabled lifecycle mutations. It is a synthetic reconstruction, not a browser capture. The new UI suite (57/57), Manager UI source checks (7/7), and production build pass. Final browser click/focus behavior remains unobserved because the existing browser security restriction prevents a new local UI route.

## Reviewability evidence correction for final Failed guidance

The Reviewability Preparation review for PR #121 at `e96ffa029a685537d777a3c35e57ca199b2fde32` found that the two Failed-state synthetic SVGs still contained the earlier startup-specific guidance after the JSX changed to phase-neutral copy. Both [`manager-failed-recovery-path-synthetic.svg`](manager-failed-recovery-path-synthetic.svg) and [`manager-failed-unregister-synthetic.svg`](manager-failed-unregister-synthetic.svg) now show the current text: “The Loop failed and no active process remains. Review diagnosis and logs before restarting.” These remain synthetic visual fixtures, not direct browser observations. The final recovery interaction is still source/test/build verified; browser evidence after the last edits remains unavailable under the existing policy limit.
