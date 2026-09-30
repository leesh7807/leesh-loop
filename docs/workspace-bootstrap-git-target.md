# 워크스페이스 부트스트랩과 Git 대상

## 설정된 base가 worker workspace에 도달하는 경로

Project의 `github_repository_url`과 `github_base_branch`가 각각 `SYMPHONY_GITHUB_REPOSITORY_URL`, `SYMPHONY_GITHUB_BASE_BRANCH`로 전달된다. Operator는 저장소와 branch를 확인하고, 설정된 base가 없을 때만 저장소 기본 branch의 현재 원격 HEAD를 seed로 사용해 base를 만든 뒤 원격에서 다시 읽어 readiness를 확인한다. 기본 branch는 workspace의 작업 대상이 아니다. (`operator/app/git-target.mjs`, `operator/app/operator-bootstrap`)

이슈별 Symphony workspace가 새로 만들어지면 `Workspace.create_for_issue/2`가 `after_create`를 실행한다. 저장소 `WORKFLOW.md`의 hook은 두 설정값이 있는지 확인한 다음 `git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .`을 수행하고 workspace 파일과 의존성을 설치한다. 기존 workspace 재사용 시에는 continuation 보존을 위해 이 생성 hook을 다시 실행하지 않는다. (`operator/symphony/lib/symphony_elixir/workspace.ex`, `WORKFLOW.md`)

작업과 PR은 다시 설정된 원격 base를 기준으로 한다. worker는 `git fetch origin "$SYMPHONY_GITHUB_BASE_BRANCH"` 후 `refs/remotes/origin/$SYMPHONY_GITHUB_BASE_BRANCH`를 해석해 task branch를 만들고, PR 생성 시 `gh pr create --base "$SYMPHONY_GITHUB_BASE_BRANCH"`를 사용한다. 따라서 clone 당시 HEAD, 새 task branch의 시작점, PR 대상은 모두 같은 설정된 base 계약을 따라야 한다. (`WORKFLOW.md`)

## 구체적인 readiness 위험

`after_create`에서 `npm ci`와 `mix deps.get`은 원격 의존성을 가져온다. hook 제한 시간을 따로 설정하지 않으면 Symphony 기본값은 60초이며, 이 시간을 넘기면 `run_hook/5`가 hook을 종료하고 timeout 오류를 반환한다. 새 workspace에서 hook이 실패하면 `create_for_issue/2`는 생성 중인 디렉터리를 정리하고 workspace 생성 실패를 반환하므로 해당 worker의 dispatch가 진행되지 않는다. cold cache나 느린 패키지 저장소에서 발생할 수 있으며, 영향은 해당 workspace의 readiness 지연 또는 실패다. (기본 timeout: `operator/symphony/lib/symphony_elixir/config/schema.ex`; 실행 및 정리: `operator/symphony/lib/symphony_elixir/workspace.ex`)

운영자는 dependency setup의 실제 최악 실행 시간을 관측하고 `hooks.timeout_ms`가 이를 수용하는지 확인해야 한다. 이 조사는 설정이나 production 동작을 변경하지 않는다.
