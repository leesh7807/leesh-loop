# 2026-09-28-remove-project-bootstrap

## Objective

PR #62에서 도입된 현재 Project bootstrap 구현과 그에 종속된 leesh-loop boot 동작을 현재 main에서 제거한다.

제거 과정에서 PR #62 이후 추가된 Operator, E2E, UI, telemetry 및 Project configuration 동작은 그대로 보존한다.

새로운 boot 구현은 이 계획의 범위에 포함하지 않는다.

## Intent

현재 bootstrap은 target별 독립 Leesh Loop runtime을 준비하려는 원래 목적과 달리, npm link된 Leesh Loop checkout의 Git 상태와 revision을 bootstrap source authority로 삼고 그 repository 전체를 sibling runtime으로 clone하는 구조를 도입했다.

그 결과 일회성 Project 생성 책임이 Operator의 주 실행 entrypoint와 결합되고, 현재 Leesh Loop checkout의 clean 상태, HEAD, origin 및 repository 전체 구조가 target Project bootstrap 계약에 포함되었다.

이 구현을 수정하면서 유지하지 않고 제거하여, 이후 boot를 다시 설계할 때 기존 clone 기반 구조나 현재 checkout의 Git identity가 전제가 되지 않게 한다.

PR #62 이후 해당 변경 위에 추가된 독립 기능까지 함께 되돌리는 것은 의도하지 않는다.

## Verification Requirements

1. 현재 main에서 leesh-loop boot와 clone 기반 Project bootstrap 동작이 더 이상 제공되지 않아야 한다.
2. Bootstrap 제거 후에도 기존 repository-local production lifecycle을 구성하는 start / stop 코드 경로와 Project configuration 계약은 그대로 보존되어야 한다. 이 계획에서는 sandbox 경계를 벗어나는 실제 npm start 실행을 완료 조건으로 요구하지 않는다.
3. PR #64 이후 도입된 open_project_surfaces를 포함해 현재 Operator Project configuration의 독립적인 동작과 기본값은 bootstrap 제거로 변경되어서는 안 된다.
4. 현재 Operator UI, Publisher, Symphony startup/readiness, E2E runtime Project 생성 및 Symphony execution telemetry 동작은 bootstrap 제거 때문에 변경되어서는 안 된다.
5. 제거 후 production 코드에는 다음 bootstrap 전용 책임이 남아 있지 않아야 한다.
   - linked Leesh Loop checkout의 clean/dirty 상태 검사
   - linked checkout의 HEAD 또는 origin을 bootstrap source identity로 사용하는 동작
   - Leesh Loop repository 전체를 target sibling runtime으로 Git clone하는 동작
   - clone revision을 bootstrap 결과로 검증하는 동작
   - 해당 clone을 전제로 operator/project.json 또는 .env를 생성하는 동작
6. PR #62 이후 다른 기능에서 독립적으로 사용하게 된 코드나 configuration authority는 bootstrap에서 기원했다는 이유만으로 제거하거나 이전 동작으로 되돌려서는 안 된다.
7. Repository 사용 문서와 현재 활성 production surface가 제거된 boot 동작을 지원되는 기능으로 안내해서는 안 된다.
8. 제거 작업은 새 bootstrap/scaffolding 방식, 새 설치 체계, 새 Project layout 또는 새 CLI lifecycle을 도입하지 않아야 한다. 새 boot는 별도 계획에서 정의한다.
9. Sandbox 실행에서 검증 가능한 범위는 정적 검토와 focused/integration test로 닫아야 하며, sandbox 밖에서만 가능한 production npm start 실실행을 이 계획의 성공 조건으로 대체 요구해서는 안 된다.

## Definitions

**PR #62**

Add leesh-loop boot project bootstrap으로 merge된 Project bootstrap 변경이다.

**현재 bootstrap**

PR #62가 도입한 leesh-loop boot entrypoint와 operator/app/project-bootstrap.mjs를 중심으로 한 clone 기반 sibling runtime 생성 동작이다.

**Semantic revert**

PR #62 merge commit을 Git 수준에서 그대로 revert하지 않고, 현재 main에서 PR #62가 소유하는 책임만 제거하면서 이후 독립 변경을 보존하는 작업이다.

**독립 후속 기능**

PR #62 이후 추가되었지만 clone 기반 bootstrap의 존재를 제품 계약으로 요구하지 않는 기능이다. 현재 확인된 범위에는 open_project_surfaces, Operator React UI, E2E runtime configuration, Symphony execution telemetry 등이 포함된다.

## Decisions

### Removal boundary

다음은 bootstrap 전용 구현으로 제거한다.

- operator/app/project-bootstrap.mjs
- operator/app/test/project_bootstrap.test.mjs
- operator/app/leesh-loop.mjs의 bootstrap import 및 boot command dispatch
- linked source checkout의 Git identity/cleanliness를 bootstrap 계약으로 다루는 코드와 테스트
- clone 기반 runtime 생성 및 revision 검증
- 현재 bootstrap 동작만을 설명하는 README 내용

PR #62의 merge commit 자체를 직접 revert하지 않는다.

### Package CLI surface

PR #62에서 추가된 root package bin 및 package metadata는 현재 bootstrap 제거 후 실제 지원되는 책임이 있는지 기준으로 정리한다.

제거 후 leesh-loop executable이 지원할 외부 명령이 없다면 bootstrap을 위해서만 존재하던 bin surface도 남기지 않는다.

npm start, npm stop, npm run e2e repository-local scripts는 유지한다.

새 boot를 위해 CLI surface가 다시 필요하면 새 bootstrap 계획에서 다시 도입한다.

### Project defaults

operator/project-defaults.mjs는 PR #62에서 처음 추가되었지만 현재는 open_project_surfaces를 포함한 Operator runtime configuration에서도 사용된다.

따라서 bootstrap 제거만을 이유로 삭제하거나 PR #62 이전의 literal default 구조로 되돌리지 않는다.

현재 runtime behavior를 보존하는 한 내부 정리는 구현에 맡기되, bootstrap 제거를 위해 불필요한 configuration churn을 만들지 않는다.

### Project example

operator/project.example.json의 현재 shape와 runtime default semantics는 bootstrap 제거의 대상이 아니다.

PR #62 이전 형태로 되돌리는 작업은 하지 않는다. 필요한 변경은 별도 Project configuration 작업에서 다룬다.

### Completed plan artifact

docs/plans/completed/2026-09-27-project-bootstrap.md는 제거되는 동작을 현재 유효한 계약처럼 참조하지 않도록 정리한다.

저장소가 completed plan을 이력으로 보존하는 현재 관례를 해치지 않는 범위에서, 해당 계획이 더 이상 현재 동작을 설명하지 않는다는 사실이 명확해야 한다. 단순히 과거 기록이라는 이유만으로 다른 completed plan까지 수정하지 않는다.

### README

README에서는 현재 구현된 clone 기반 bootstrap의 설치 및 실행 안내를 제거한다.

새 bootstrap 사용법을 이번 작업에서 대신 작성하지 않는다. 현재 실제로 지원되는 repository-local 실행 방법만 남긴다.

### Protected scope

다음 영역의 현재 동작은 이 계획에서 변경하지 않는다.

- Operator start / stop lifecycle
- Project configuration loading과 validation
- external readiness 및 skip_external_readiness
- open_project_surfaces
- Publisher 및 Operator UI
- Symphony startup, dispatch, observability
- E2E workload 및 run-local Project 생성
- execution telemetry
- target repository Git binding의 production 사용
- workspace lifecycle
- project.json 공개 여부 또는 그 별도 변경

이 범위를 넘어서는 변경이 필요하면 별도 계획으로 다룬다.

### Naming

Bootstrap 제거 후 남는 파일, module, function 이름은 현재 실제 책임을 나타내야 한다.

더 이상 존재하지 않는 bootstrap, generated runtime, linked source authority 같은 abstraction을 이름이나 공용 API에 남기지 않는다.

반대로 현재 Operator runtime에서 실제로 공유되는 Project defaults 등은 과거 기원이 bootstrap이었다는 이유만으로 이름을 바꾸지 않는다.

## Verification

### 1. Bootstrap surface 제거

현재 production source와 root package surface를 확인해 다음이 더 이상 production 실행 경로에 존재하지 않음을 확인한다.

- leesh-loop boot
- bootstrapProject
- project-bootstrap.mjs
- linked checkout clean/revision/origin 검사
- bootstrap용 git clone

Bootstrap 전용 테스트도 현재 test suite에서 제거되어 있어야 한다.

외부 CLI 경계는 실제 surface에 맞춰 직접 확인한다.

- root package의 bin surface가 유지되는 경우, focused CLI test에서 leesh-loop boot가 지원 명령으로 dispatch되지 않고 실패함을 확인한다.
- root package의 bin surface 자체가 제거되는 경우, package metadata readback으로 leesh-loop executable이 더 이상 제공되지 않음을 확인한다.

이 검증은 내부 bootstrap 코드가 없어졌다는 사실만으로 대체하지 않는다.

### 2. Production lifecycle preservation

실제 npm start는 sandbox 경계를 벗어나므로 이 계획의 worker verification에서는 실행하지 않는다.

대신 현재 start / stop production path를 직접 대상으로 하는 기존 focused/integration tests와 source-level contract inspection으로 다음을 확인한다.

- start / stop command dispatch가 그대로 존재함
- Project configuration loading과 validation이 그대로 연결됨
- Operator readiness와 Symphony launch path가 bootstrap 제거로 변경되지 않음
- lifecycle state/ownership cleanup path가 bootstrap 제거와 무관하게 유지됨

이번 변경이 start / stop path를 수정하지 않거나 bootstrap import 제거 외의 semantic diff를 만들지 않는 것도 final diff에서 확인한다.

### 3. Project configuration regression

Operator focused tests를 통해 최소한 다음 현재 계약을 확인한다.

- open_project_surfaces omitted → 현재 default 유지
- open_project_surfaces: false → browser surface 자동 dispatch 억제
- skip_external_readiness와 독립적으로 동작
- 기존 port/timeout/default resolution 유지
- start/stop config loading 유지

### 4. 후속 기능 regression

현재 main의 관련 focused suites를 실행해 bootstrap 제거와 직접 충돌할 수 있는 다음 영역을 확인한다.

- Operator UI
- workspace files/config
- E2E Project configuration
- E2E runner
- Operator client / execution evidence
- Symphony telemetry 관련 tests

Bootstrap 제거로 인한 실패가 있으면, 제거된 bootstrap 계약을 복원해서 해결하지 않고 후속 기능이 실제 bootstrap-independent contract만 사용하도록 정리한다.

### 5. Documentation readback

README와 현재 production documentation에서 clone 기반 leesh-loop boot가 지원되는 현재 사용법으로 남아 있지 않은지 확인한다.

과거 completed plan을 제외한 현재 사용자-facing 안내가 실제 executable surface와 일치해야 한다.

### 6. Final diff review

최종 diff를 PR #62의 변경 범위와 현재 main의 후속 변경에 대조해 다음을 확인한다.

- bootstrap 책임은 제거됨
- PR #64 이후 독립 기능은 함께 되돌아가지 않음
- 새 bootstrap 설계가 우회적으로 추가되지 않음
- unrelated Operator/E2E/Symphony behavior 변경이 없음
- start / stop production path는 bootstrap 제거에 필요한 최소 diff 외에는 변경되지 않음

 git diff --check를 통과해야 한다.

실제 production npm start / npm stop은 sandbox 경계 때문에 이 계획의 worker verification 범위에서 수행하지 않는다. 따라서 이번 검증은 해당 lifecycle을 새로 입증하는 것이 아니라, 이미 존재하는 production path가 이번 semantic revert로 변경되지 않았음을 정적 diff와 기존 focused/integration tests로 확인하는 데 한정한다.

## Verification Tools

- **Git diff / history**: PR #62에서 도입된 책임과 이후 PR에서 재사용된 코드를 구분하고 final semantic revert 범위를 확인한다.
- **Focused CLI test / package metadata readback**: 남은 package surface에 따라 leesh-loop boot가 실제 외부 명령으로 더 이상 제공되지 않음을 확인한다.
- **Node test runner**: Operator config, UI, workspace 및 lifecycle command path의 regression을 검증한다.
- **E2E focused tests**: run-local Project 생성과 E2E orchestration이 bootstrap 제거와 독립적으로 유지되는지 확인한다.
- **Symphony test suite**: startup/telemetry 관련 후속 기능이 영향을 받지 않았는지 확인한다.
- **Source/diff inspection**: sandbox에서 실행할 수 없는 production npm start / npm stop 경로가 이번 변경으로 semantic하게 수정되지 않았음을 확인한다.
- **git diff --check**: 최종 patch의 기본 정합성을 확인한다.
