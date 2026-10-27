# Manager and CLI redesign evidence

## Artifact identity

- UI and Manager source commit: `5bc8ef1ca401f788aff3f7e23894f544b3ff5821`
- Active Runtime and Manager Runtime: `f365dd09f747a0b0ddfed0472553a4a7f7787dad58f6d770df64466c75b6fd96`
- Isolated profile: `.manager-redesign-final.yAr95Q/profile2` in the task workspace (temporary verification data)
- Manager URL: `http://127.0.0.1:45789/`
- Screenshot browser: Google Chrome, 1440×1000

This evidence describes the redesigned implementation. Older captures and synthetic fixtures elsewhere in `docs/ui-evidence/` are historical and must not be treated as renders of this delivery.

## Direct browser evidence

[`projects-same-name-desktop.png`](projects-same-name-desktop.png) is a screenshot written by Chrome from the live Manager UI and Runtime identified above. The Projects screen contains two registered local Git repositories both named `demo`. Their full repository roots, upstream branches, distinct Loop data locations, stopped states, and project-scoped actions are visible. The same screen includes the pre-registration path field and its repository check action. These repositories are temporary verification fixtures; no real user repository or Task data is shown.

The live Chrome interaction was also observed through the Manager UI. It covered project registration and selection, publishing and opening a Task, navigation between Work and System, switching between the two same-name repositories, and return to the original Task. A dirty comment draft remained associated with the original project across Work → System → Work, project switching away and back, and page reload. A direct SQLite read found no persisted comment record for that unsent draft. These interactions are direct observations; the SQLite result is authoritative storage readback.

The baseline comparison is recorded in Workpad sequence 1: the earlier live Manager put repository registration, project switching, Task work, lifecycle, and lower-page Runtime/Workflow controls in one long screen. The final Workpad entry links that observed problem to the Projects, Work, and System result here.

## CLI and service readback

After the Manager Service was stopped, the authenticated `POST /api/v1/manager/stop` response stated that the service was stopping and Loops would continue. The port then refused connections. No Loop was running in this fixture profile, so Worker continuity was not exercised.

After the stop, the CLI Manager entry point was invoked and the service later answered authenticated API queries. Readback confirmed `Running`, the same active and Manager Runtime ID above, and both isolated projects still registered with `Stopped` status. `node bin/leesh-loop.mjs list` returned both project names and full paths. A later no-argument CLI invocation refused to launch a second Manager because it could not verify the process identity of the already responding service. The task command environment uses a separate process namespace for these invocations, so that identity check could not be established there. The browser automation bridge also timed out while reconnecting to Chrome; the post-restart page render was not re-observed. API and CLI list readbacks establish service availability and registry continuity, but not a verified CLI open result or post-restart visual state.

The CLI stop path initially reported that the Manager was already stopped while the HTTP service was still reachable; this came from the command environment's process namespace being unable to observe the Manager PID. The service was then stopped through its authenticated Manager API, and subsequent HTTP refusal verified the outcome. Do not treat the CLI stop command's earlier message as evidence that it stopped the service.

## Evidence boundaries

- Observed: live Chrome navigation, project selection, same-name disambiguation, Task detail continuity, and draft persistence in the browser tab.
- Observed and read back: Manager API health, active Runtime identity, registry contents, and stopped Loop states after restart.
- Observed: existing Task Store remained separate per project; the verification Task and unsent draft belonged only to the first project.
- Test-verified: UI, Manager/CLI integration, and full repository suite. The final full suite result is 204 passed, 1 skipped, 0 failed.
- Not exercised: an actively running Loop or Worker during Manager stop/restart; the temporary repositories were not suitable for starting a Worker.
- Not directly observed after restart: the final browser page render, because the Chrome control bridge timed out. The existing Chrome tabs remained listed at the Manager URL; tab metadata alone is not UI evidence.
- Historical/synthetic screenshots are not used to establish this redesign's visual result.
