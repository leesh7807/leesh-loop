# Workspace bootstrap과 Git target 전달

## 전달 경로

E2E 실행 설정의 `repository_url`과 run-scoped `baseBranch`는 Operator Project의 `github_repository_url`과 `github_base_branch`가 된다. Operator는 설정된 base branch를 먼저 읽고, 없을 때만 저장소 default branch의 현재 commit에서 만들며 remote readback을 수행한다. 이후에도 configured ref를 다시 읽어 readiness 기록에 commit을 남긴다.

Operator는 두 값을 `SYMPHONY_GITHUB_REPOSITORY_URL`과 `SYMPHONY_GITHUB_BASE_BRANCH` 환경 변수로 Symphony에 전달한다. 새 worker workspace의 `after_create`는 두 값이 있는지 확인하고 다음을 실행한다.

```sh
git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .
```

따라서 `origin`은 설정된 저장소이고 checkout은 clone 시점의 설정 branch tip이다. 그 뒤 hook은 설정된 `workspace_files`를 workspace 안에 복사하고 worker 의존성을 설치한다. 작업 branch를 만들기 전에는 설정된 remote base를 fetch하고 그때 해석한 commit을 기준으로 삼는다.

근거: `operator/e2e/model/e2e-project-config.mjs`, `operator/app/operator-bootstrap`, `operator/app/git-target.mjs`, `operator/app/leesh-loop.mjs`, `operator/e2e/WORKFLOW.md`, `operator/app/workspace-files.mjs`.

## 구체적인 격리 위험

저장소의 일반 Operator 설정인 `operator/project.json`은 `workspace_files`에 `../.env`를 지정한다. 새 worker workspace는 이 파일을 checkout 뒤 자기 root에 복사하므로 해당 worker 프로세스가 파일 내용을 읽을 수 있다. `.gitignore`는 보통의 실수성 add를 줄이지만 읽기나 출력 자체를 막지는 않는다. worker 명령이나 로그가 값을 출력하거나 파일을 강제로 stage하면 credential이 workspace 밖으로 유출될 수 있다. 평소에는 낮은 가능성이지만 영향은 높다. 필요한 파일만 이 목록에 두고 credential 값을 출력하거나 commit하지 않아야 한다. E2E가 생성하는 run별 Operator Project는 별도로 이 목록을 전달하지 않는다.
