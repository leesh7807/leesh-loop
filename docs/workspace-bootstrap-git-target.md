# Workspace bootstrap과 Git target 조사

## 설정에서 worker workspace까지

Project의 `github_repository_url`과 `github_base_branch`는 Operator가 `SYMPHONY_GITHUB_REPOSITORY_URL`과 `SYMPHONY_GITHUB_BASE_BRANCH`로 전달한다. Operator bootstrap은 HTTPS 인증 경로를 확인하고, `git-target.mjs`로 설정된 원격 base가 있는지 확인한다. 없으면 원격 default branch의 현재 commit을 새 base로 만들고 원격에서 다시 읽는다. 외부 readiness를 생략하지 않으면 최종 base commit도 원격에서 다시 읽어 readiness 기록에 남긴다. (`operator/app/leesh-loop.mjs`, `operator/app/operator-bootstrap`, `operator/app/git-target.mjs`)

Symphony는 issue workspace를 새로 만들 때만 `after_create`를 실행한다. 이 hook이 설정된 URL과 branch를 사용해 workspace 안에 clone한 다음, `operator/app/workspace-files.mjs`로 Project의 workspace 파일을 복사하고 worker dependency를 준비한다. 이어지는 dispatch는 기존 workspace를 유지한다. 따라서 새 workspace의 출발점은 설정된 원격 저장소의 설정된 base branch이며, 작업과 delivery도 그 설정된 base를 기준으로 한다. (`operator/symphony/lib/symphony_elixir/workspace.ex`, `WORKFLOW.md`)

## 구체적인 격리 위험

Project의 `workspace_files`는 설정된 일반 파일을 새 worker workspace로 복사한다. 검증은 파일 종류와 workspace 경로, 대상 파일 덮어쓰기를 제한하지만 파일 내용이 credential인지 검사하지 않는다. 설정에 credential-bearing 파일이 들어가면 Codex worker가 그 내용을 읽을 수 있고, ignore 규칙이 없는 이름이면 실수로 commit/PR에 포함될 수 있다. 비밀값을 `workspace_files`에 넣지 않고 비민감 실행 입력만 전달해야 한다. 위험 가능성은 해당 Project 설정에 달렸고 낮게 유지할 수 있지만, 포함됐을 때의 영향은 credential 노출이다. (`operator/app/leesh-loop.mjs`, `operator/app/workspace-files.mjs`)

## 집중 확인

실행: `node --test operator/app/test/git_target.test.mjs operator/app/test/operator_bootstrap.test.mjs operator/app/test/workspace_files.test.mjs`

결과: **25 passed, 0 failed**. 설정 base의 생성/재사용/readback, Operator readiness 경로, 실제 `after_create` clone 뒤 workspace 파일 복사, continuation의 workspace 보존을 확인했다. 생산 동작이나 credential 설정은 변경하지 않았다.
