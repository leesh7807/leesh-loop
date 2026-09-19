# Workspace bootstrap과 Git target contract 조사

## 결론

설정된 Git target은 Operator 설정에서 시작해 `SYMPHONY_GITHUB_REPOSITORY_URL`·`SYMPHONY_GITHUB_BASE_BRANCH` 환경 변수로 Symphony에 전달되고, 새 worker workspace의 `after_create`에서 해당 저장소의 해당 branch를 clone하는 경로로 연결된다. 다만 readiness에서 읽은 exact `github_base_commit` SHA는 worker에 전달·고정되지 않고 clone 시점 branch tip이 사용된다. 아래 경로는 확인했지만 production behavior나 credential은 변경하지 않았다.

## 실제 도달 경로

1. `operator/app/leesh-loop.mjs:54-66`이 `github_repository_url`과 `github_base_branch`를 필수 설정으로 읽고 branch 형식을 검증한다. `:71-74`의 runtime identity에도 두 값이 포함되고, `:203-204`에서 같은 값을 각각 `SYMPHONY_GITHUB_REPOSITORY_URL`과 `SYMPHONY_GITHUB_BASE_BRANCH`로 Symphony 프로세스에 넘긴다.
2. Operator readiness는 `operator/app/operator-bootstrap:108-149`에서 두 환경 변수를 필수로 확인하고, `operator/app/git-target.mjs:68-97`로 configured base를 읽거나 default branch HEAD에서 생성한 뒤 remote readback을 수행한다. 시작 직전에도 `operator/app/operator-bootstrap:262-298`에서 configured base commit을 다시 읽어 readiness record에 기록한다. 이 SHA는 readiness evidence일 뿐 worker 환경 변수로 전달되지 않는다.
3. 새 workspace의 실제 hook은 `WORKFLOW.md:23-36`이다. 두 변수를 먼저 요구한 뒤 `git clone --branch "$SYMPHONY_GITHUB_BASE_BRANCH" "$SYMPHONY_GITHUB_REPOSITORY_URL" .`을 실행하고, workspace 파일 복사와 worker dependency 설치를 이어간다. 따라서 readiness readback과 workspace checkout 사이에 branch가 전진하면 readiness에는 commit A, workspace에는 clone 시점의 commit B가 남을 수 있다.
4. Symphony는 `operator/symphony/lib/symphony_elixir/workspace.ex:21-31`에서 workspace를 준비한 뒤 hook을 호출한다. `:40-51`에서 디렉터리가 이미 있으면 `created?`를 `false`로 보고, `:289-305`에서 `after_create`는 `created? == true`일 때만 실행한다. 따라서 continuation은 보존된 workspace를 그대로 사용한다.

## Contract 경계

현재 경로가 보장하는 binding은 repository URL과 branch 이름이다. readiness의 `github_base_commit`과 worker의 실제 `HEAD`가 같은지까지는 이 경로가 보장하지 않는다. 이 경계는 아래 readiness risk와 별개의 관찰이며, exact commit 재현성이 요구되면 추가 계약 또는 검증이 필요하다.

## 구체적인 readiness risk

**Hook 도중 중단된 workspace가 다음 실행에서 준비 완료로 오인될 수 있다.** 새 디렉터리를 만든 직후 `after_create`가 clone 또는 dependency 설치를 수행하는 동안 Symphony/worker 프로세스가 중단되면, 디렉터리는 남지만 bootstrap 완료 표식은 저장되지 않는다. 다음 `create_for_issue` 호출에서 같은 경로가 디렉터리라는 이유로 `created? == false`가 되고 hook을 건너뛴다(`workspace.ex:40-51`, `:289-305`). 그 결과 `.git`, configured origin/branch, 또는 dependencies가 없는 부분 workspace에서 agent가 시작될 수 있다.

일반적인 hook 실패는 `created? == true`인 새 workspace를 정리하는 경로(`workspace.ex:307-317`)가 있어 복구되지만, 이 보호는 프로세스/호스트가 정리 전에 갑자기 종료되는 경우에는 실행되지 않는다. 영향은 cross-task 데이터 노출로 확인된 것은 아니며, 이 조사에서 확인된 concrete risk는 “준비되지 않은 workspace가 ready로 재사용되는 readiness 손실”이다. 완화하려면 재사용 전 bootstrap 완료 상태와 Git target을 검증하거나, 완료 표식을 durable하게 남기는 별도 변경이 필요하지만 이번 작업 범위에서는 수정하지 않았다.

## Focused check

실행한 명령:

```sh
node --test operator/app/test/git_target.test.mjs operator/app/test/workspace_files.test.mjs
```

실제 결과: **15 passed, 0 failed** (`duration_ms 396.679913`). 이 결과는 configured base의 생성/readback·기존 branch 보존, 설정 identity, 그리고 실제 `after_create` clone 뒤 workspace-file materialization 순서를 확인한다. Live Symphony 프로세스의 비정상 종료 복구와 실제 GitHub readiness는 이 focused check의 범위 밖이다.
