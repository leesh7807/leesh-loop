# Workspace contract 조사 노트

## configured base가 worker workspace에 도달하는 경로

1. Project 설정의 `github_repository_url`과 `github_base_branch`를 `operator/app/leesh-loop.mjs`가 읽고, Symphony 실행 환경에 각각 `SYMPHONY_GITHUB_REPOSITORY_URL`과 `SYMPHONY_GITHUB_BASE_BRANCH`로 전달한다 (`leesh-loop.mjs:203`).
2. `operator/app/operator-bootstrap`은 두 값을 필수로 검증하고, `operator/app/git-target.mjs`를 호출해 configured base를 원격에서 read하거나 없으면 repository default branch의 현재 HEAD를 seed로 생성한 뒤 원격 branch/commit을 readback한다 (`operator-bootstrap:109-149`, `git-target.mjs:68-98`).
3. Symphony의 `Workspace.create_for_issue/2`가 새 issue workspace를 만들 때만 `hooks.after_create`를 실행한다. 기존 workspace를 재사용하는 continuation에서는 이 hook을 다시 실행하지 않는다 (`operator/symphony/lib/symphony_elixir/workspace.ex:20-31`, `289-305`). 따라서 정상 계약이라면 이 hook이 위 환경변수로 configured base를 clone하고 dependency bootstrap을 수행해야 한다.

## 확인된 readiness risk

현재 `WORKFLOW.md`는 `after_create` hook이 configured repository를 clone하고 dependencies를 설치한다고 설명하지만, 실제 파일에는 `hooks.after_create` YAML 정의나 `git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .` 명령이 없다. Symphony 쪽 구현은 `hooks.after_create`가 `nil`이면 새 workspace를 만든 뒤 그대로 성공 처리한다 (`workspace.ex:294-303`). 그 결과 Operator의 Git target readiness가 통과해도 fresh workspace가 clone/dependency bootstrap 없이 agent에 전달될 수 있고, agent가 빈 workspace에서 작업하거나 잘못된 checkout을 사용할 수 있다.

가장 직접적인 확인으로 `node --test operator/app/test/workspace_files.test.mjs`를 실행했다. 실제 결과는 **FAIL** (`11 tests`, `10 pass`, `1 fail`)이며, 실패한 테스트 `the actual after_create materialization command runs after clone and before bootstrap consumption`가 `WORKFLOW.md`에서 clone/materialization/bootstrap 순서를 검증하는 정규식을 찾지 못했다. 이번 작업에서는 production behavior나 credential을 변경하지 않고, 이 contract gap만 기록했다.
