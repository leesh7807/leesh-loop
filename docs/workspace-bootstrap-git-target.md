# Workspace bootstrap과 Git target 경로

## 설정에서 worker workspace까지

1. Project 설정은 `github_repository_url`, `github_base_branch`, `symphony_workspace_root`를 요구한다. Operator는 branch 이름을 Git ref 형식으로 검사하고 workspace 경로를 정규화한다. 기본 설정에서 workspace root는 저장소 바깥이어야 한다 (`operator/app/leesh-loop.mjs:47-65`, `operator/app/operator-bootstrap:45-69`).
2. Bootstrap은 GitHub HTTPS 접근과 인증을 확인한다. `git-target.mjs`는 설정된 branch가 있으면 그대로 읽고, 없으면 원격 default branch HEAD를 fetch해 설정된 branch를 생성한 뒤 원격에서 다시 읽는다. 외부 readiness 생략이 꺼진 기본 경로에서는 readiness 기록 직전 configured base 커밋을 다시 읽어 저장소 URL, branch와 함께 workspace 밖의 readiness 파일에 기록한다 (`operator/app/operator-bootstrap:119-160,265-303`, `operator/app/git-target.mjs:50-107`).
3. Operator는 동일한 `SYMPHONY_GITHUB_REPOSITORY_URL` 및 `SYMPHONY_GITHUB_BASE_BRANCH` 값을 Symphony 프로세스 환경에 전달한다 (`operator/app/leesh-loop.mjs:273-279`). 새 workspace의 `after_create`는 이 저장소의 설정 branch를 clone한 뒤 설정된 `workspace_files`를 복사하고 worker 의존성을 설치한다 (`WORKFLOW.md:24-31`). production workflow는 task branch를 fetch한 configured base 커밋에서 만들고 PR을 동일한 configured base로 열도록 요구한다. Operator가 configured base bootstrap을 소유하며, 신규 workspace는 해당 저장소의 clone 시점 configured-base commit을 checkout한다 (`WORKFLOW.md:155,165-167`). 따라서 저장소·branch 선택은 Operator 설정을 따라가고, workspace의 HEAD는 clone 시점 branch 커밋이다.

## 구체적인 isolation 위험

`workspace_files`에 비밀이 든 일반 파일을 지정하면 그 바이트가 worker checkout 안으로 복사되어 worker가 읽을 수 있다. 코드가 검사하는 것은 경로, 일반 파일 여부, workspace 경계, 중복 파일명이며 민감도는 분류하지 않는다 (`operator/app/workspace-files.mjs:17-51`). 트리거는 Project 설정에 credential-bearing 파일(예: 비밀값을 포함한 `.env`)을 포함하는 경우다. 그 경우 영향은 해당 값의 worker 노출이며, 민감 파일에 대해서는 발생 가능성이 설정자 선택에 달려 있다. `workspace_files`에는 비밀이 없는 worker 입력만 지정하고 credentials는 Operator의 외부 credential 저장소에 둬야 한다.

## 집중 점검 결과

- `node --test operator/app/test/workspace_files.test.mjs`: 16 passed, 0 failed. 설정 branch를 명시해 실제 `after_create` clone 명령을 로컬 bare 저장소에서 실행하는 테스트와 continuation 보존 테스트를 포함한다.
- `node --test operator/app/test/git_target.test.mjs`: 4 passed, 0 failed. 기존 설정 branch 보존, 없는 configured base 생성 및 원격 readback을 확인한다.
- 이는 기존 로컬 Git 테스트 경로의 결과다. live Operator에서 GitHub 인증부터 Symphony dispatch까지 이어지는 실행은 이 조사에서 수행하지 않았다.
