# 2026-09-27-e2e-fast-pr-workload-catalog

## Objective

기본 E2E가 실제 production 실행 경로와 PR 생성까지 유의미하게 통과하는지를 가능한 빠르게 확인할 수 있도록 E2E workload catalog를 정리한다.

Catalog에는 실제 repository 변경과 PR 대상으로 성립할 수 있으면서도 작업 자체의 복잡성 때문에 E2E 시간이 불필요하게 길어지지 않는 단순 workload 3~4개를 둔다.

대표적인 기본 catalog E2E를 통해 이 workload pool이 실제 production Publisher → Operator → Symphony → worker → delivery lifecycle → PR 생성 경로에서 정상 동작함을 확인한다.

## Intent

현재 E2E catalog의 workload는 저장소 내부 구조 조사, 문서 작성, 검증 및 정상 delivery 준비까지 포함해 실제 작은 개발 작업에 가까우며, 기본 E2E가 확인하려는 실행 경로에 비해 작업 자체의 비용이 크다.

기본 catalog E2E에서는 worker의 복잡한 문제 해결 능력이나 `WORKFLOW.md` 내부 정책의 세부 의미를 폭넓게 검증하기보다, 실제 Accepted Plan이 publication되고 worker가 repository를 변경한 뒤 정상 lifecycle을 거쳐 실제 PR을 만들 수 있는지를 빠르고 반복 가능하게 확인하는 데 집중한다.

Catalog의 각 workload는 정상 worker가 작은 repository 변경과 PR 대상으로 해석할 수 있을 만큼 완전하고 결정적인 작업이어야 한다. 그러나 catalog의 모든 항목을 각각 production E2E로 실행해 별도의 integration coverage를 확보하는 것은 이 계획의 목적이 아니다. 대표적인 catalog workload를 실제 production 경로로 실행해 catalog 기반 기본 E2E의 PR 생성 경로를 실증한다.

특정 Accepted Plan의 의미나 특정 내부 workflow 정책 자체가 중요한 검증은 catalog에 일반화하지 않는다. 그런 경우에는 기존 provided Plan과 provided workflow 입력을 직접 주입하여 해당 시나리오를 명시적으로 검증한다.

따라서 기본 catalog E2E와 주입형 scenario E2E는 같은 production E2E 경로를 사용하되 검증하려는 의미를 구분한다.

## Verification Requirements

- Catalog에는 서로 독립적으로 실행할 수 있는 단순 workload가 3~4개 존재해야 한다.
- 각 catalog workload는 실제 tracked repository 변경을 요구하고 commit 및 PR 대상으로 성립할 수 있는 완전한 작업이어야 한다.
- 각 workload의 성공 조건은 명확하고 작업 범위가 작아야 하며, 저장소 전반 조사나 복잡한 설계 판단 없이 정상 worker가 빠르게 수행할 수 있어야 한다.
- Catalog workload는 production behavior, credentials, 외부 서비스 configuration처럼 E2E 확인에 불필요한 고위험 영역을 변경하도록 요구하지 않아야 한다.
- 기본 catalog E2E는 기존 production Publisher → Operator → Symphony → worker → delivery lifecycle 경로를 그대로 사용해야 하며, 빠른 workload를 위해 별도 단축 runtime이나 가짜 delivery 경로를 만들지 않아야 한다.
- 대표적인 기본 catalog E2E를 실제 production 경로로 실행해 repository 변경과 실제 PR 생성까지 정상 도달함을 확인해야 한다.
- Catalog workload의 hard cap은 기존 값을 단순히 유지하거나 임의의 목표 시간으로 고정하지 않고, 접근 가능한 기존 E2E timing 기록을 근거로 정상 성공 run에는 충분한 여유를 주면서 정체된 run을 가능한 일찍 종료할 수 있는 수준으로 조정해야 한다.
- Catalog workload 및 hard cap 조정 이후 대표적인 기본 E2E가 기존보다 불필요한 workload 수행 시간을 줄이면서 PR 생성까지 정상 도달함을 확인할 수 있어야 한다.
- 특정 Accepted Plan 또는 `WORKFLOW.md` 의미가 검증 대상인 경우 기존 provided Plan / provided workflow 주입 경로를 사용할 수 있어야 하며, catalog 정리가 그 경로의 의미나 동작을 변경하지 않아야 한다.
- 기존 E2E run evidence에는 workload/workflow provenance와 실제 timing 정보가 계속 남아야 하며, catalog 실행과 주입 실행을 사후 구분할 수 있어야 한다.

## Definitions

- **Catalog workload**: `operator/e2e/catalog.json`에서 기본 E2E가 선택하는 Accepted Plan 후보. 빠른 production-path 확인을 목적으로 한다.
- **Default catalog E2E**: 별도 Accepted Plan을 제공하지 않고 catalog에서 workload를 선택해 수행하는 E2E 실행.
- **Provided Plan**: `--plan`을 통해 직접 제공되는 Accepted Plan. 특정 작업 의미를 검증하기 위한 입력이다.
- **Provided workflow**: `--workflow`를 통해 직접 제공되는 workflow 문서. 특정 workflow semantics가 검증 대상일 때 사용한다.
- **Scenario E2E**: provided Plan 또는 provided workflow를 사용해 특정 작업이나 workflow 계약을 의도적으로 검증하는 E2E 실행.
- **Hard cap**: workload 실행이 무한정 지속되지 않도록 제한하는 E2E run 시간 경계. Catalog 항목별 값은 실제 timing evidence를 기준으로 정한다.
- **Timing record**: E2E durable run record에 남는 전체 run, Symphony startup/worker, lifecycle, chatgpt-shot 등의 실제 관측 시간 정보.

## Decisions

### Catalog 역할

Catalog는 실제 제품 backlog나 유용한 개발 작업 목록으로 취급하지 않는다. 각 workload의 책임은 worker가 실제 repository 변경과 PR 대상으로 해석할 수 있을 만큼 완전한 작업이면서, E2E infrastructure와 lifecycle 검증보다 큰 비용이나 불확실성을 만들지 않는 작은 작업인 것이다.

기존 조사 중심 workload는 이 기준에 맞춰 교체한다. 새 catalog workload는 3~4개만 유지하며 숫자를 늘려 coverage를 확보하거나 모든 workload를 각각 production E2E로 실행하는 별도 coverage 계약을 만들지 않는다. 별도 semantics 검증이 필요하면 provided input을 사용한다.

### Workload 선택 기준

각 workload는 하나의 작은 repository 변경으로 끝나는 독립적인 작업이다. 실제 tracked source 또는 documentation 변경이어서 commit과 PR 대상으로 성립하고, 결과가 명확해 제품 결정이나 대규모 코드 탐색·설계 검토를 요구하지 않아야 한다. 생성 파일만 추가했다가 삭제하는 E2E 전용 변경보다 repository 안에서 정상적인 작은 변경을 우선한다. 검증 명령은 변경 크기에 비례하는 직접적인 수준으로 제한한다. 계획 문구는 현재 repository 상태와 불필요하게 결합하지 않는다.

### 실행 시간과 hard cap

현재 catalog의 각 장시간 hard cap을 새 catalog 성격에 맞게 재평가한다. 구체적인 분 단위 목표를 미리 고정하지 않는다. 접근 가능한 기존 E2E durable record를 조사하고 전체 run observed duration, Symphony start 및 worker observed duration, lifecycle state별 observed timing, chatgpt-shot observed duration을 활용해 병목과 정상 소요 시간을 판단한다.

정상 run의 실제 분포와 고정 orchestration 비용을 고려해 빠르게 실패를 드러내면서도 정상 변동으로 쉽게 timeout되지 않도록 한다. 기록이 충분하지 않으면 변경 후 대표 catalog E2E의 실제 timing을 근거로 정하며, 근거 없는 짧은 시간을 계약으로 만들지 않는다. Provided Plan의 기존 기본 hard cap과 명시적 override 계약은 catalog 조정과 분리한다.

### Workflow semantics 경계

기본 `operator/e2e/WORKFLOW.md`는 default catalog E2E의 production lifecycle workflow로 유지한다. Catalog workload는 review, blocker, merge, handoff 등 workflow clause를 의도적으로 깊게 시험하지 않는다. 해당 의미가 검증 대상인 작업은 provided Plan 및 필요한 경우 provided workflow를 주입하는 별도 scenario E2E로 수행한다. 기존 입력 통로가 목적을 충족하는 한 새 E2E mode나 scenario catalog abstraction을 추가하지 않는다.

### 기존 입력 및 evidence 계약

Catalog 선택 workload의 random 기본 선택, 기존 materialization 및 provenance 기록, Provided Plan의 production Publisher 직접 전달, Provided workflow snapshot 및 provenance 기록, run-local Project와 runtime option 기록, E2E timing/evidence durable run record 저장을 유지한다. Catalog 정리를 이유로 이들 책임을 재설계하지 않는다.

### 작업 단위

- **Catalog workload 정리**: 빠르면서 실제 repository 변경과 PR 대상으로 성립하는 3~4개의 기본 workload pool을 만든다.
- **E2E 실행 시간 경계 정리**: 실제 timing evidence를 기준으로 catalog hard cap을 조정하고 근거를 보존한다.
- **Catalog와 scenario 입력의 역할 문서화**: default catalog E2E와 provided Plan/workflow E2E 목적 차이를 문서화해 기존 입력 경로를 의도에 맞게 선택할 수 있게 한다.

### Protected scope

다음은 변경 대상으로 삼지 않는다: production Operator/Symphony lifecycle, Publisher publication semantics, PR review/merge policy를 포함한 workflow 정책, provided Plan publication semantics, provided workflow runtime semantics, external readiness 경계, E2E finalization 및 cleanup 계약, production credentials 또는 E2E binding 구조. Catalog 단순화에 이 영역 변경이 필요하면 별도 계획으로 둔다.

### Naming

현재 구현과 일치하는 `catalog`, `workload`, `provided Plan`, `provided workflow`, `run timing` 용어를 유지한다. 새 구성요소가 필요하면 실제 책임이 이름에 드러나도록 하며, 존재하지 않는 smoke/scenario framework 같은 추상화 계층을 미리 만들지 않는다.

## Verification

### Catalog 구성 확인

최종 `catalog.json`에서 3~4개의 작고 독립적인 workload를 검토한다. 각 Plan이 실제 tracked repository 변경, commit/PR 대상이 되는 완전한 작업, 명확한 성공 조건을 요구하고, 불필요한 repository-wide 조사나 복잡한 판단 또는 production behavior/credentials 변경을 피하는지 확인한다. 모든 workload의 full production E2E 실행은 요구하지 않는다. 기존 focused catalog validation tests가 있으면 model contract를 확인한다.

### Timing 근거 및 hard cap 확인

접근 가능한 기존 성공 run의 실제 전체 run, Symphony, worker, lifecycle, chatgpt-shot timing을 조사해 작업 수행 시간과 고정 orchestration 비용을 구분한다. 변경 후 대표 catalog E2E timing도 같은 durable record에서 확인한다. 최종 evidence에서 실제 run duration, 선택 workload, hard cap, worker와 주요 lifecycle timing, timeout 없는 lifecycle 완료를 확인할 수 있어야 한다.

### Representative production E2E

기본 catalog 입력으로 적어도 한 번 기존 production 경로를 실행한다. Publisher → run-local Operator → Symphony → worker → repository change → delivery lifecycle → 실제 PR 생성 흐름을 관찰한다. 최종 run evidence와 GitHub readback으로 선택 Accepted Plan에 연결된 PR임을 확인한다. 기존 정책이 PR 이후 Human Review에서 멈추면 그 terminal policy를 따르며 merge는 요구하지 않는다.

실행 시간은 변경 전 workload의 절대 시간과 임의 비율로 비교하지 않는다. 새 workload가 의도한 작은 작업으로 실제 완료되고, timing record에 불필요한 장시간 작업이 제거되었으며, 선택한 hard cap 안에서 production 경로가 진행됐는지 확인한다.

### Provided input 회귀 확인

기존 focused test 또는 가장 직접적인 CLI verification으로 `--plan`이 provided workload로 해석되고, `--workflow`가 제공된 workflow snapshot으로 사용되며, 제공 입력이 catalog 변경으로 materialization되지 않고, run record에서 catalog와 provided provenance를 구분할 수 있음을 확인한다. 변경하지 않는 workflow semantics 자체를 새로 E2E 검증할 필요는 없다.

## Verification Tools

- **E2E durable run records (`operator/e2e/runs/<run-id>/run.json`)**: 전체 run, Symphony, worker, lifecycle, chatgpt-shot timing과 workload/workflow provenance 및 적용 runtime 정보를 확인한다.
- **`npm run e2e` / E2E CLI**: 실제 production Publisher → Operator → Symphony → worker lifecycle을 통해 대표 catalog workload를 실행한다.
- **GitHub PR readback**: 대표 worker가 실제 repository 변경을 delivery하여 PR을 생성했는지 확인한다.
- **Notion task/readback 및 E2E run evidence**: publication된 Accepted Plan과 실제 task/run identity가 일치하는지 확인한다.
- **E2E model/focused tests**: catalog validation, workload selection/materialization, provided Plan/workflow provenance 경계의 회귀를 확인한다.
- **Git diff 및 repository validation**: 변경 범위와 repository 기존 validation을 확인한다.
