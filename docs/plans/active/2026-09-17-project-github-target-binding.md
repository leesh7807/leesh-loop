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

- 리뷰한 HEAD: `b8e0dfa` (`https://github.com/leesh7807/leesh-loop/pull/32`)
- verdict: `BLOCKED` — `chatgpt-shot submit`이 Job ID 반환 전에 `CHATGPT_AUTH_REQUIRED`로 실패했다.
- finding: 리뷰 결과 문서가 반환되지 않아 확정된 finding 없음. 인증 복구 없이는 수용/기각 판단 불가.
- 적용한 커밋: 없음.
- 검증 결과: Node 20개, Elixir 330개(6 skipped), publisher 25개, Git bootstrap integration 및 `git diff --check` 통과. Live Operator는 base branch 생성·readback 후 chatgpt 인증 blocker로 dispatch 전에 중단되었고, branch/Notion task/runtime artifact는 정리했다.
- 리뷰한 HEAD: `b8e0dfa` (`https://github.com/leesh7807/leesh-loop/pull/32`), Job `a5004103-ba39-474e-9857-8fdd1d139afd`
- verdict: `FINDINGS`였으나 유효 finding 없음.
- `[medium] Concurrent base creation can be accepted at the wrong commit` 기각: 지정 HEAD의 `git-target.mjs:87-95`는 push 실패 후 authoritative remote readback으로 branch 존재를 확인한다. Accepted Plan이 다른 실행이 먼저 같은 branch를 만들면 최종 readback의 현재 branch를 그대로 사용하도록 명시했으므로, readback commit을 default HEAD와 비교하지 않는 것은 의도된 concurrency contract이며 결함이 아니다. 수정하지 않았다.
- 적용한 커밋: 없음. Live verification 재실행은 readiness evidence, real Symphony dispatch, workspace 생성, configured origin/branch/HEAD/remote ancestry readback까지 통과했고, 종료 후 branch·Notion task/Plan·runtime artifact를 정리했다.
