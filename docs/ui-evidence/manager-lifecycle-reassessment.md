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

After that fix, the isolated Manager was restarted from a source snapshot matching the checkout and the Runtime worker completed the no-change update path. A full new Runtime install and Loop start remain unverified: the Runtime build requires Symphony compilation, which fails in this environment because `/bin/sh: cmake: command not found`. No running user Manager or Loop was stopped or changed.

## Evidence limits

- The repositories and Task were temporary local data; the GitHub-shaped URLs are illustrative metadata, not external GitHub repositories.
- No Loop process was started, so live `Running`, readiness, stop, and process-owned unregister behavior rely on the focused Manager lifecycle tests rather than this browser session.
- Browser confirmation behavior for Workflow apply and unregistration is not directly verified because the connected browser control timed out while accepting JavaScript dialogs. Their service outcomes and persistence effects were verified through the real local Manager and authoritative readback.
- Local E2E was attempted twice and failed during Symphony startup before Worker dispatch. Run `aded4033-5e97-441f-959b-9f597ecd748b` timed out while compiling `date_time_parser`; retry `f0caaffc-5647-4038-a8a4-23ffbce69348` reported the Mix build lock held by process 92 and timed out waiting for the state API. Logs remain under `/tmp/leesh-loop-local-e2e-ZuRUT0/` and `/tmp/leesh-loop-local-e2e-wIOzOf/`.
- Screenshots were visually inspected in Chrome during the task but are not stored here; the evidence is the direct interaction record and API/filesystem/SQLite observations above.

## Runtime identity follow-up

During review, the browser evidence exposed that showing only `0.1.0` for the active Runtime, Manager service, and selected Loop could conceal that these are different immutable distributions. The implementation now renders each distribution's version together with a 12-character identity prefix and retains the full ID as a tooltip. This final label change is covered by three UI tests and the production Vite build. The browser observations above came from the immediately preceding built snapshot, before the identity-prefix follow-up; the final labels were not re-captured in a browser. Thus, the source checkout versus installed Runtime distinction was directly browsed, while the final active/Manager/Loop ID labels are test-verified and build-verified.
