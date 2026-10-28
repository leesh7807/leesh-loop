# Active Loop and Worker continuity evidence

## Artifact identity and environment

- Captured source HEAD: `60979699b09ec74e5f1faaf12bb8f34a067d268d`
- Active Runtime and Manager Runtime: `050b74f7e1e1c7cf4af9d572a3f9e983838e076c3787ee1d830821171cc6c59d`
- Isolated XDG profile: `/tmp/leesh-loop-manager-continuity.3PetOR` (removed after verification)
- Manager URL: `http://127.0.0.1:45738/`
- Browser: Google Chrome through the browser automation extension; actual page screenshots, 1217×570 pixels
- Project: temporary Git repository registered by the real CLI; Loop Instance ID `07dd7d8c-492e-4767-a545-4fd4b2cfb5c8`
- Continuity Task: `PLAN-FBACE631-4F6F-4277-A718-F91E0B16B60C`, Task ID `7bb11af8-60b5-4022-b932-d6cb4e85e790`

The screenshots are direct captures from Chrome after Manager restart. They show the actual Manager UI and Task Store, not a reconstructed or synthetic UI. The repository and task data were temporary fixtures; the Manager, Loop runtime, Codex Worker, and Local Task Store were real.

## Browser captures

- [Manager reentry and completed Task](manager-reentry-task-detail.jpg) shows the selected project as Running and the Task's saved State as Done after reloading the existing tab.
- [Worker Workpad after Manager reentry](manager-reentry-workpad.jpg) shows both timestamped Workpad entries in the actual Task detail.

## Shutdown and reentry sequence

The actual CLI registered and started the project. The real Manager UI published the Accepted Plan. A real Codex Worker process (`codex`, PID `62628`) recorded the first Workpad line and remained alive in a signal wait. Before shutdown, the Manager, Loop, and Worker PID start identities were recorded in [`pre-stop.json`](pre-stop.json).

`node bin/leesh-loop.mjs manager stop` reported:

```text
Manager Service stopped. Running Loops and Workers continue independently.
Continuing: repository (...)
```

During Manager unavailability, [`manager-down.json`](manager-down.json) records all of the following:

- Manager PID `54054` with start ticks `421868` was absent, its service record was absent, and port `45738` refused connections.
- Loop PID `61800` retained start ticks `462641`.
- Codex Worker PID `62628` retained start ticks `465564`; a descendant `sleep` process confirmed it was still waiting.
- Read-only SQLite showed the `before-manager-stop` Workpad entry while the Manager was down. The Task Store remained accessible to the Worker.

After that readback, the verifier created the signal file. The Worker then appended `continuity-phase: after-manager-stop` and set the Task to `Done`. [`worker-progress-while-manager-down.json`](worker-progress-while-manager-down.json) records the authoritative SQLite state and both Workpad entries while the Manager port was still closed and the Loop identity was unchanged.

The verifier reopened Manager using `node bin/leesh-loop.mjs list`. CLI readback returned `Running`; authenticated Manager API readback confirmed a new Manager PID `68401`, the same Loop PID/start identity, and Task State `Done`. [`manager-reentry.json`](manager-reentry.json) contains that readback. Reloading the same Chrome tab restored the selected project and Task detail with both Workpad entries.

## Worker service setup

The installed `chatgpt-shot` executable exposed the worker-facing `submit`/`jobs` interface, not the service administration commands checked by Operator bootstrap. The isolated instance alone used `skip_external_readiness = true`; no skip was added to the product UI or default project configuration. The real loopback service health check succeeded, and smoke Job `878d826a-b1e8-4049-a741-b0cc95990f99` completed with `READY`. The actual Codex Worker then used the normal Symphony Local Task tools and production Manager/Loop lifecycle.

The first 45-second Worker attempt ended before the verifier stopped Manager and is not used as continuity evidence. The second run gated Worker completion on an external signal created only after Manager shutdown and process readback. No repository files were modified by the test Worker, and no GitHub command or write was made by it.

## Evidence limits

This directly establishes that one real Codex Worker and its Loop continued through an explicit Manager Service shutdown, wrote to the same Local Task Store while Manager was unavailable, and were rediscovered after CLI reentry. It does not establish every Worker failure mode, Runtime update path, or all-platform process behavior. The Task Store State remained `Ready` during active processing until the Worker completed it as `Done`; Workpad and OS process readback identify the active execution interval.
