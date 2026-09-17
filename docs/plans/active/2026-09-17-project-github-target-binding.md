# 2026-09-17-project-github-target-binding

## Objective

Bind every Project to the configured GitHub repository and base branch in
`project.json`. Make Operator readiness own base-branch bootstrap and pass the
same binding through workspace creation, task branching, Rework, PR delivery,
Merging, and Done verification in the bundled root workflow.

## Scope

- Require `github_repository_url` and `github_base_branch` in Operator config.
- Bootstrap a missing configured base from the repository default branch HEAD,
  then verify the created remote branch and commit before dispatch.
- Include repository and base branch in runtime identity and readiness evidence.
- Pass `SYMPHONY_GITHUB_REPOSITORY_URL` and `SYMPHONY_GITHUB_BASE_BRANCH` to the
  worker environment.
- Update the bundled root `WORKFLOW.md`, README, example config, and targeted
  tests. Leave `docs/WORKFLOW_TEMPLATE.md` unchanged.
- Run the requested isolated live Operator verification with the supplied
  Notion database, then run the `chatgpt-shot` review loop for the exact PR HEAD.

## Verification

- Node Operator/config tests and real local-Git bootstrap integration tests.
- Root workflow contract tests, README/example inspection, and `git diff --check`.
- Isolated temporary project config, workspace root, state directory, ports,
  Notion task, and configured `e2e/<run-id>` branch through the real Operator
  entry point.
- Exact-HEAD `chatgpt-shot` review loop; independently validate every finding,
  apply only evidence-backed fixes, and re-review every resulting HEAD.

## chatgpt-shot review log

