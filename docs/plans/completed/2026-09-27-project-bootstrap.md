# 2026-09-27-project-bootstrap

## Objective

Leesh Loop 저장소를 한 번 local setup한 사용자가 어느 Git 프로젝트에서든 `leesh-loop boot`를 실행해 해당 프로젝트용 sibling Leesh Loop runtime을 준비할 수 있게 한다.

생성된 runtime은 현재 target checkout을 기준으로 자동 결정 가능한 Project 설정이 이미 채워져 있어야 하며, 사용자는 외부에서만 알 수 있는 production environment binding을 `.env`에 채운 뒤 기존 Leesh Loop production 실행 경로를 사용할 수 있어야 한다.

Bootstrap의 책임은 project-specific production runtime 준비까지다. Leesh Loop repository 자체의 E2E 실행에 필요한 추가 environment binding이나 E2E lifecycle은 bootstrap 대상에 포함하지 않는다.

## Intent

현재 새 프로젝트를 Leesh Loop로 실행하려면 Leesh Loop checkout, `project.json`, 대상 repository URL과 base branch, workflow path, workspace 위치, `.env` 전달 관계 등을 사용자가 직접 구성해야 한다.

Project environment binding 작업 완료 후에는 Notion database URL과 token처럼 repository 자체에서 유도할 수 없는 production 값이 `.env`로 분리되고, Project local path는 config-relative path와 `~`를 사용할 수 있다.

이 구조를 이용해 프로젝트별 반복 setup을 `leesh-loop boot` 하나로 줄인다.

Leesh Loop CLI 자체는 `chatgpt-shot`과 같은 local development/install 관례를 따른다. 사용자는 Leesh Loop 저장소를 clone한 뒤 필요한 setup과 `npm link`를 한 번 수행하고, 이후에는 repository 위치와 무관하게 `leesh-loop` 명령을 사용한다.

대상 프로젝트의 worker policy는 프로젝트가 소유한다. Bootstrap은 프로젝트 정책을 설계하거나 변환하지 않고, 이미 Leesh Loop용 `WORKFLOW.md`가 준비된 프로젝트와 project-specific Leesh Loop runtime을 연결한다.

External readiness가 필요하지 않은 실행을 위해 기존 Operator의 external-readiness skip 계약도 bootstrap 시 선택할 수 있게 한다.

Linked CLI checkout은 bootstrap source authority다. 생성 runtime과 실제 실행한 CLI가 서로 다른 Leesh Loop source를 사용하지 않도록 bootstrap은 clean Git checkout에서만 수행한다. Linked CLI checkout에 local working-tree 변경이 있으면 이를 복제하거나 해석하지 않고 bootstrap을 실패시킨다.

`npm run e2e`와 `LEESH_LOOP_E2E_NOTION_DATABASE_URL`은 Leesh Loop repository의 별도 검증 환경에 필요한 추가 설정으로 취급한다. Generic project bootstrap은 이를 생성하거나 동작을 보장하지 않는다.

## Verification Requirements

1. Leesh Loop 저장소에서 documented local setup과 `npm link`를 한 번 수행하면 repository 밖의 임의 directory에서도 `leesh-loop` executable을
 호출할 수 있어야 한다.

2. Leesh Loop용 `WORKFLOW.md`가 존재하는 Git repository root에서 실제 `leesh-loop boot`를 실행하면 target 이름을 반영한 sibling runtime이 생성되고, 해당 target을 production 경로로 실행할 수 있는 Leesh Loop configuration이 준비되어야 한다.

3. Runtime Root는 기본적으로 `<target-project-name>-loop`라는 sibling 이름을 사용한다. 같은 이름의 sibling path가 이미 존재하면 기존 내용을 재사용·수정·삭제하지 않고 명확히 실패해야 한다.

4. `leesh-loop boot`는 생성될 runtime 내부 script를 먼저 직접 호출하거나 해당 runtime이 이미 존재할 것을 요구해서는 안 된다. 전역 link된 Leesh Loop CLI가 bootstrap 진입점을 소유해야 한다.

5. 생성된 `operator/project.json`은 target checkout과 runtime에서 합리적으로 결정 가능한 값을 자동으로 채워야 한다. 최소한 다음 값은 사용자의 추가 입력 없이 실제 target과 연결되어야 한다.
   - 대상 프로젝트의 `WORKFLOW.md`
   - Symphony workspace root
   - worker에 전달할 runtime `.env`
   - 현재 target checkout과 연결된 Git repository URL
   - 현재 target checkout과 연결된 base branch
   - 현재 Leesh Loop가 사용하는 일반적인 Project defaults

6. Git repository URL과 base branch는 현재 target checkout과 그 checkout에 연결된 remote/upstream 정보를 기준으로 선택해야 한다. Bootstrap 성공 시 실제로 선택한 repository URL과 base branch를 사용자에게 명시적으로 알려야 한다.

7. Bootstrap이 자동으로 생성한 Git binding은 초기 configuration이다. 사용자가 그 결과가 의도한 repository/base와 다르다고 판단하면 이후 생성된 `operator/project.json`을 직접 수정할 수 있어야 한다.

8. 현재 checkout에서 repository URL 또는 base branch를 합리적으로 결정할 수 있는 연결 정보가 전혀 없는 경우 임의의 repository나 `main` 같은 fallback을 만들어 성공 처리해서는 안 된다.

9. 사용자가 직접 채워야 하는 값은 repository 또는 bootstrap 환경에서 자동 결정할 수 없는 production environment binding으로 제한한다. Runtime `.env`의 bootstrap 기본 surface는 다음 값을 제공해야 한다.
   - `NOTION_TOKEN`
   - `LEESH_LOOP_NOTION_DATABASE_URL`

10. `LEESH_LOOP_E2E_NOTION_DATABASE_URL`과 그 밖의 E2E-specific binding은 generic bootstrap surface에 포함하지 않는다. 필요한 경우 Leesh Loop repository의 E2E 환경에서 별도로 구성한다.

11. Bootstrap은 environment binding의 실제 값을 발견하거나 추측하는 책임을 갖지 않는다. 일반 bootstrap 결과의 `.env`는 사용자가 직접 값을 채울 수 있는 surface를 제공하는 것으로 충분하다.

12. 대상 프로젝트의 기존 `WORKFLOW.md`는 project-owned configuration으로 취급하며 bootstrap이 수정하거나 대체해서는
 안 된다.

13. 대상 프로젝트에 `WORKFLOW.md`가 없으면 bootstrap은 임의의 worker policy를 생성해 성공 처리하지 않고 필요한 파일이 없다는 구체적인 오류로 종료해야 한다.

14. `leesh-loop boot --no-external`로 생성한 Project는 기존 Operator의 external readiness를 생략하도록 구성되어야 한다. 이 옵션은 대상 프로젝트의 `WORKFLOW.md`를 변경하거나 그 안의 external worker dependency를 제거하는 기능이 아니다.

15. 정상 bootstrap 결과에서는 생성된 sibling runtime에서 기존 production `npm start`가 별도의 configuration 변환 없이 생성된 Project/environment structure를 사용해야 하며, 시작된 runtime은 기존 `npm stop` lifecycle로 종료할 수 있어야 한다.

16. Bootstrap에 사용하는 Linked CLI checkout은 clean Git working tree여야 한다. tracked 또는 untracked local 변경이 있어 source identity를 Git revision 하나로 확정할 수 없으면 bootstrap은 runtime을 생성하지 않고 명확히 실패해야 한다.

17. 생성 Runtime Root는 bootstrap에 사용된 Linked CLI checkout의 현재 Git revision을 기준으로 준비되어야 하며, 해당 revision 관계를 Git identity로 확인할 수 있어야 한다.

18. 대표 검증은 실제 `npm link`로 노출된 `leesh-loop` executable을 repository 밖에서 호출하는 경로부터 시작해, 실제 target Git repository에서 `leesh-loop boot`를 실행하고 생성된 runtime에서 실제 `npm start`가 정상적으로 시작되는 데까지 도달해야 한다.

19. 대표 검증에서 environment binding은 검증 환경에 이미 존재하는 유효한 production `.env` binding을 사용한다. 검증은 해당 binding 값을 출력하거나 별도로 readback하지 않고 production startup이 이를 그대로 사용할 수 있음을 확인하면 충분하다.

20. `--no-external`도 실제 linked CLI → bootstrap → 생성 runtime → `npm start` 경로에서 external readiness가 startup을 차단하지 않는 데까지 확인해야 한다.

21. Existing Runtime Root 보존은 실제 Linked CLI 경로에서 확인한다. 기존 sibling runtime에 식별 가능한 sentinel을 둔 상태에서 `leesh-loop boot`가 실패하고 기존 runtime과 sentinel을 변경하지 않아야 한다.

22. Worker dispatch나 task lifecycle 진행은 bootstrap 성공을 판정하기 위한 요구사항이 아니다.

23. `npm run e2e`의 실행 가능성이나 E2E lifecycle 성공은 bootstrap 완료 또는 검증 조건이 아니다.

## Definitions

**Leesh Loop CLI checkout**

사용자가 직접 clone하고 local setup한 Leesh Loop repository. `npm link`의 source이며 `leesh-loop` executable implementation을 제공한다.

**Linked CLI**

Leesh Loop CLI checkout에서 `npm link`를 통해 사용자의 PATH에 노출된 `leesh-loop` executable이다.

**대상 프로젝트(Target Project)**

`leesh-loop boot`를 실행하는 Git repository. Leesh Loop가 작업 대상으로 사용하는 repository다.

**Target Name**

Target Project root directory의 project name이다. 기본 Runtime Root의 sibling 이름을 결정하는 데 사용한다.

**Runtime Root**

Target Project의 sibling인 `../<target-project-name>-loop`. Bootstrap이 준비하는 project-specific Leesh Loop checkout과 local runtime configuration의 root다.

**Bootstrap**

Linked CLI가 Target Project의 existing configuration과 Git 정보를 읽어 Runtime Root와 local Project configuration을 준비하는 작업이다.

**Project**

Runtime Root의 `operator/project.json`으로 표현되는 Leesh Loop runtime configuration이다.

**Environment Binding**

Repository 자체에서 자동 유도할 수 없고 사용자가 `.env`를 통해 제공하는 production 외부 값이다.

**External readiness**

Operator startup 전에 확인하는 Leesh Loop 외부 capability readiness다. 현재 기존 `skip_external_readiness`가 제어하는 범위를 의미한다.

`--no-external`은 이 readiness 경계만 제어하며 target `WORKFLOW.md`의 정책을 변환하지 않는다.

## Decisions

### CLI installation

현재 공식 local installation flow는 `chatgpt-shot`과 같은 `npm link` 방식으로 둔다.

Leesh Loop repository에서 필요한 repository setup을 수행한 뒤:

```bash
npm link
```

를 실행하면 `leesh-loop` command가 PATH에서 사용 가능해야 한다.

Root package가 `leesh-loop` executable을 `bin` entry로 노출한다.

이번 계획에서는 다음을 추가하지 않는다.

- npm registry publish
- global installer shell script
- Homebrew package
- self-update mechanism
- 별도 CLI launcher repository

### Command surface

Canonical bootstrap command는:

```bash
leesh-loop boot
```

로 한다.

External readiness를 제외하려면:

```bash
leesh-loop boot --no-external
```

을 사용한다.

`bootstrap`, `init`, `setup` 등의 동의어는 추가하지 않는다.

기존 Leesh Loop CLI command surface에 `boot`를 추가하며 Bootstrap 전용 두 번째 CLI framework는 만들지 않는다.

### Target selection

`leesh-loop boot`를 실행한 current working directory를 Target Project root로 사용한다.

대상 경로 selector, project registry, interactive selection은 추가하지 않는다.

Target은 다음을 만족해야 한다.

- Git repository root
- 현재 checkout과 연결된 repository
 remote/upstream 정보를 확인할 수 있음
- 현재 checkout에서 base branch를 결정할 수 있음
- project-owned `WORKFLOW.md` 존재

### Runtime location

기본 Runtime Root는:

```text
<parent>/
├── <target-project>/
└── <target-project>-loop/
```

로 한다.

동일한 Runtime Root path가 이미 존재하면 충돌로 실패한다.

Existing runtime을 자동으로 재사용, 업데이트, 삭제, reset하거나 새 target에 다시 연결하지 않는다.

Custom runtime destination option은 이번 계획에 추가하지 않는다.

### Runtime source

Bootstrap은 Linked CLI가 속한 Leesh Loop checkout을 source authority로 사용한다.

Bootstrap을 시작하기 전에 해당 checkout이 clean Git working tree인지 확인한다. tracked 또는 untracked local 변경이 있으면 runtime을 생성하지 않고 실패한다.

Bootstrap은 현재 Linked CLI checkout의 repository identity와 현재 checkout revision을 기준으로 Runtime Root에 project-specific Leesh Loop checkout을 준비한다.

단순 recursive file copy로 local ignored state, runtime state, dependency directory 등을 복제하지 않는다.

Runtime Root는 정상 Git checkout이어야 하며 bootstrap에 사용된 Linked CLI checkout과 동일한 Leesh Loop revision을 기준으로 만들어졌는지 Git identity로 확인할 수 있어야 한다.

Dirty working tree의 변경을 runtime으로 복사하거나 stash, patch, commit하는 기능은 추가하지 않는다.

이를 구현하는 구체적인 Git command sequence는 구현에 맡긴다.

### Git binding

`github_repository_url`과 `github_base_branch`는 Target Project의 현재 checkout과 연결된 Git metadata를 기준으로 생성한다.

현재 checkout에 upstream/tracking 관계가 있다면 그 연결 관계를 우선 사용한다. 필요한 repository/base 정보를 해당 관계에서 얻을 수 없는 경우 현재 checkout의 Git configuration에서 직접 연결된 정보를 사용한다.

Bootstrap은 일반적으로 현재 checkout과 무관한 remote를 추측하거나 canonical repository를 별도로 판별하는 책임을 갖지 않는다.

선택 결과는 bootstrap 성공 출력에 명시한다.

사용자는 생성 후 `operator/project.json`을 직접 수정해 repository/base를 변경할 수 있다.

### Project generation

`operator/project.json`은 bootstrap이 실제 target/runtime evidence를 기준으로 생성한다.

자동 결정 대상은 다음과 같다.

- `workflow_path`: target의 기존 `WORKFLOW.md`
- `symphony_workspace_root`: Runtime Root 기준 local workspace directory
- `workspace_files`: Runtime Root의 `.env`
- `github_repository_url`: current checkout과 연결된 repository
- `github_base_branch`: current checkout과 연결된 base
- model/reasoning/ports/timeouts: 현재 Project의 canonical defaults
- `skip_external_readiness`: `--no-external` 사용 시 `true`, 그 외 기존 default

Environment-binding 작업에서 Project 밖으로 이동한 database URL을 다시 `project.json`에 넣지 않는다.

`project.example.json`을 bootstrap 전용 template authority로 만들지 않는다. 현재 Project defaults의 authoritative source가 있다면 bootstrap과 example이 이를 재사용하며 bootstrap 때문에 독립된 두 번째 default 집합을 만들지 않는다.

### Environment file

Runtime Root에 `.env`를 생성한다.

Bootstrap이 제공하는 기본 production surface는:

```dotenv
NOTION_TOKEN=
LEESH_LOOP_NOTION_DATABASE_URL=
```

로 한다.

`LEESH_LOOP_E2E_NOTION_DATABASE_URL`은 bootstrap이 생성하지 않는다. 이는 E2E를 실행하는 환경에서 필요할 경우 별도로 추가하는 repository-specific verification binding이다.

Bootstrap은 production binding 값을 Git remote, process environment, 다른 프로젝트 configuration 등에서 추측하거나 복사하지 않는다.

일반 사용에서는 bootstrap 후 사용자가 직접 production 값을 채운다.

### Workflow ownership

Bootstrap은 Target Project의 `WORKFLOW.md`를 수정하지 않는다.

`WORKFLOW.md`가 없는 프로젝트를 위한 generic workflow 생성은 이 계획에 포함하지 않는다.

### `--no-external`

`--no-external`은 생성 Project의 기존 `skip_external_readiness` 설정만 제어한다.

새 external mode, 별도 Project schema, 별도 startup path를 만들지 않는다.

Target `WORKFLOW.md`가 `chatgpt-shot` 같은 external capability를 요구하는 경우에도 해당 worker policy는 그대로 유지된다.

### Setup documentation

Repository 사용 문서는 최소한 다음 canonical flow를 제공한다.

```bash
git clone <leesh-loop-repository>
cd leesh-loop
<repository-required-setup>
npm link

cd /path/to/target-project
leesh-loop boot

cd ../<target-project-name>-loop
# fill production .env
npm start
```

`<repository-required-setup>`은 실제 repository dependencies/build 요구사항을 사용하며 bootstrap을 위해 불필요한 별도 setup 단계를 만들지 않는다.

E2E-specific `.env` 설정은 이 generic bootstrap flow에 포함하지 않는다.

### Success output

성공 시 최소한 다음 정보를 표시한다.

```text
Leesh Loop created: ../<target-project-name>-loop
Project: <target>
Repository: <selected repository>
Base: <selected branch>
Workflow: <path>
External readiness: enabled|disabled

Review operator/project.json if the selected repository or base is not intended.

Complete .env, then:
  cd ../<target-project-name>-loop
  npm start
```

### Protected scope

다음 기존 책임과 계약은 변경하지 않는다.

- `start`, `stop`, `serve`, `e2e` lifecycle semantics
- Project environment binding semantics
- Publisher publication/validation semantics
- Symphony scheduling, dispatch, retry, continuation semantics
- workspace lifecycle semantics
- `skip_external_readiness`의 기존 의미
- `chatgpt-shot` Service와 worker interface
- Target Project의 `WORKFLOW.md`
- Target Project의 build/test/release policy

Bootstrap은 기존 E2E lifecycle을 변경하지 않지만, 이를 generic bootstrap 성공 계약으로 가져오지도 않는다.

Bootstrap 구현을 위해 위 기존 계약 변경이 필요하면 별도 계획으로 분리한다.

### Naming

사용자 command spelling은 `boot`로 한다.

내부 file/module/type/major function 이름은 실제 책임인 project bootstrap, runtime preparation, target discovery, Project generation 등을 드러내야 한다.

아직 존재하지 않는 installer, package manager, project registry, environment manager 같은 abstraction을 이름에 도입하지 않는다.

## Verification

### Linked CLI

Clean Leesh Loop checkout에서 documented local setup과 실제:

```bash
npm link
```

를 수행한다.

Leesh Loop repository 밖에서 `leesh-loop` 또는 read-only usage invocation을 실행해 PATH의 executable이 해당 checkout의 CLI entry point로 resolve되는 것을 확인한다.

Repository-local `node operator/...` 직접 호출로 이 검증을 대체하지 않는다.

### Canonical bootstrap flow

Leesh Loop용 `WORKFLOW.md`가 있는 대표 Target Project에서 Runtime Root가 존재하지 않는 상태로:

```bash
leesh-loop boot
```

를 실제 Linked CLI를 통해 실행한다.

다음 observable evidence를 확인한다.

- `../<target-project-name>-loop`가 생성됨
- Runtime Root가 정상 Leesh Loop Git checkout임
- Runtime Root revision이 bootstrap source checkout의 현재 revision과 일치함
- `operator/project.json`이 생성됨
- production `.env`가 생성됨
- `.env` 기본 surface가 `NOTION_TOKEN`, `LEESH_LOOP_NOTION_D
ATABASE_URL`을 제공함
- E2E-specific binding이 bootstrap 기본 surface에 추가되지 않음
- Target Project의 `WORKFLOW.md`가 변경되지 않음
- workflow/workspace/env path가 실제 target/runtime을 가리킴
- repository/base가 현재 checkout의 Git 연결 관계를 기준으로 생성됨
- bootstrap output이 선택한 repository/base를 명시적으로 표시함

### Production startup

대표 검증에서는 현재 검증 환경에 이미 존재하는 유효한 production `.env` binding을 사용한다.

검증 과정에서 credential이나 database URL 값 자체를 출력하거나 별도로 readback하지 않는다.

해당 binding을 생성 Runtime Root가 사용할 `.env`로 제공한 뒤:

```bash
npm start
```

를 실제 실행한다.

다음을 확인하면 대표 bootstrap flow가 성공한 것으로 본다.

- 생성된 `operator/project.json`을 production startup이 정상적으로 읽음
- runtime `.env`를 production environment binding으로 정상 사용함
- target repository/base/workflow configuration으로 startup이 정상적으로 성립함
- `npm start` 자체가 bootstrap 결과의 configuration 문제 없이 시작됨

실제 worker dispatch, task pickup, task completion까지 진행시키는 것은 이 계획의 성공 조건이 아니다.

검증 후 기존:

```bash
npm stop
```

으로 실행한 runtime을 종료한다.

### External-readiness-disabled flow

별도의 clean Target Project에서:

```bash
leesh-loop boot --no-external
```

을 실제 Linked CLI로 실행한다.

생성된 Project에서 기존 `skip_external_readiness=true`가 사용되는 것을 확인한다.

동일한 기존 유효 production `.env` binding을 내용 노출 없이 사용해:

```bash
npm start
```

를 실행한다.

External readiness가 startup을 차단하지 않고 production startup이 정상적으로 시작되는 것까지 확인한다.

Target workflow의 실제 worker 작업이 external capability 없이 완료되는지까지는 주장하지 않는다.

### Existing Runtime Root preservation

대표 Target Project와 동일한 이름의 sibling Runtime Root를 미리 만든다.

그 Runtime Root에 bootstrap이 생성한 것이 아님을 식별할 수 있는 sentinel 파일 또는 동등한 기존 내용을 둔다.

Target Project에서 실제 Linked CLI를 사용해:

```bash
leesh-loop boot
```

를 실행한다.

다음을 확인한다.

- command가 non-zero로 종료됨
- existing Runtime Root collision이 실패 원인으로 명확히 표시됨
- 기존 Runtime Root가 삭제, reset, 교체 또는 재사용되지 않음
- sentinel과 기존 runtime 내용이 그대로 유지됨
- 성공한 bootstrap으로 오해할 수 있는 변경이 기존 Runtime Root에 추가되지 않음

이 검증은 existing sibling에 대한 destructive behavior 금지를 실제 사용자 entry point에서 확인하는 대표 failure path다.

### Other failure paths

다음 admission/failure contract는 focused bootstrap/CLI tests로 확인한다.

- `WORKFLOW.md`가 없는 Target Project
- Git repository가 아닌 directory
- current checkout에서 필요한 repository/base 연결 정보를 결정할 수 없는 repository
- Linked CLI source checkout이 dirty인 경우

각 경우 다음 observable result를 검증한다.

- non-zero로 종료됨
- 실패 원인이 구체적으로 표시됨
- 기존 Target Project를 수정하지 않음
- 새 Runtime Root를 성공한 bootstrap으로 오해할 수 있는 상태로 남기지 않음

이 deterministic failure contract를 모두 별도의 실제 `npm link` integration scenario로 반복 검증하지 않는다.

### Dirty source check

Focused test에서 Linked CLI source checkout에 local working-tree 변경이 있는 상태를 구성한다.

`leesh-loop boot`가 runtime source를 임의로 선택하거나 local 변경을 복제하지 않고 Runtime Root 생성 전에 명확히 실패하는 것을 확인한다.

Clean checkout에 대해서는 canonical bootstrap flow의 Git identity readback으로 동일 revision의 runtime이 생성됨을 확인한다.

### E2E boundary

Bootstrap 검증에서 `npm run e2e`를 실행하지 않는다.

`LEESH_LOOP_E2E_NOTION_DATABASE_URL` 설정 여부와 E2E lifecycle 성공 여부도 bootstrap 성공 판정에 사용하지 않는다.

기존 E2E entry point의 semantics 자체는 protected scope로 유지되며, bootstrap 변경 때문에 이를 수정하지 않았는지는 변경 diff와 필요한 focused regression test를 통해 확인한다.

### Repository regression

변경과 직접 관련된 기존 Operator/CLI/Project loading focused tests와:

```bash
git diff --check
```

를 실행한다.

필요한 기존 suite가 bootstrap이 건드린 protected contract를 직접 포함한다면 해당 suite를 실행한다.

이 테스트들은 실제:

```text
npm link
→ repository 밖에서 linked CLI 사용
→ target에서 leesh-loop boot
→ <target>-loop 생성
→ 기존 유효 production .env binding 사용
→ npm start
```

경로를 대체하지 않는다.

또한 focused failure tests는 실제 Linked CLI를 통한 existing Runtime Root preservation 검증을 대체하지 않는다.

이 대표 성공 경로와 existing Runtime Root preservation 경로를 실행하지 못하면 objective를 완료했다고 판정하지 않는다.

## Verification Tools

- **npm `bin` / `npm link`**: Leesh Loop checkout이 repository-independent `leesh-loop` command를 실제 제공하는지 확인한다.
- **Linked `leesh-loop` CLI**: 사용자가 실제 사용하는 bootstrap entry point, 대표 성공 경로, `--no-external` 경로, existing Runtime Root preservation을 확인한다.
- **Git CLI**: CLI source checkout cleanliness, checkout revision, Runtime Root checkout identity, Target Project root, 현재 checkout의 remote/upstream 및 base binding을 확인한다.
- **Filesystem readback**: Runtime Root, sentinel, Project, production `.env`, 기존 `WORKFLOW.md`의 생성·보존 상태를 확인한다.
- **Production Project loader / `npm start`**: 생성 Project와 기존 유효 production `.env` binding이 실제 production startup에서 정상적으로 사용되는지 확인한다.
- **`npm stop`**: 대표 검증에서 시작한 runtime을 기존 lifecycle을 통해 종료한다.
- **Focused bootstrap/CLI tests**: deterministic admission/failure contract와 dirty source rejection을 검증한다.
- **Focused repository tests**: bootstrap과 CLI exposure가 직접 접촉한 기존 계약의 회귀를 확인한다.
- **`git diff --check`**: 최종 repository patch integrity를 확인한다.
