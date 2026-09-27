# 2026-09-27-e2e-project-surface-opening-control

## Objective

Keep the production `leesh-loop start` → Publisher → Symphony path in E2E while preventing its automatic desktop browser opening of the Publisher UI, Notion database, and Symphony dashboard. Preserve the default browser-opening experience for existing interactive Projects.

## Accepted behavior

- Add the Operator Project boolean `open_project_surfaces`. If omitted, it defaults to `true`; invalid non-boolean values are rejected.
- The setting controls only automatic desktop dispatch of the three Project surfaces during the current `start` invocation. It does not disable Publisher UI preparation, Publisher build/serve, Symphony startup, dashboard HTTP, or E2E publication/lifecycle observation.
- Do not add `open_project_surfaces` to effective runtime identity. A live compatible runtime can be reused while the policy changes between `start` invocations.
- When the setting is `false`, do not dispatch any browser request and do not create or update `project_window_opened_at`. Keep that runtime state reserved for successful automatic opening. A later enabled invocation with no opening timestamp must use the existing one-shot opening behavior and record the timestamp only after successful dispatch.
- Do not use `project_window_opened_at` to suppress opening for a disabled invocation. Do not conflate this Project policy with `skip_external_readiness`.
- Generate run-local E2E Projects with `open_project_surfaces: false` and `skip_external_readiness: true`, each recorded independently. Do not create a separate E2E startup path or override `LEESH_LOOP_BROWSER_COMMAND` to make it a no-op.

## Boundaries

Keep the Publisher publication behavior and lifecycle ownership, Symphony runtime/dashboard, external readiness and its skip contract, E2E workload and finalization semantics, and existing one-shot `project_window_opened_at` meaning intact. The change controls only desktop surface dispatch.

## Verification

- Verify omitted/default-enabled and explicit-disabled Project parsing, boolean validation, independent `skip_external_readiness`, and runtime compatibility when only the opening policy changes.
- Verify run-local E2E Project generation stores both settings independently.
- Exercise the same Operator start path with browser-dispatch observation: disabled start has no dispatch or opening timestamp while Publisher UI and Symphony are ready; a later enabled start on the compatible runtime opens the three surfaces and records the timestamp.
- Run the focused Operator tests, E2E tests, and `git diff --check`.
- Run `npm run e2e` through its real production startup path and observe browser-launch requests without opening a desktop browser. Confirm Publisher and Symphony runtime/API readiness and existing lifecycle observation. If the environment prevents a full run, report precisely which representative evidence was obtained and which remains unverified.
