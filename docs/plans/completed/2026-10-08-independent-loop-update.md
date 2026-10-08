# 2026-10-08-independent-loop-update

## Objective

`leesh-loop init`으로 생성된 독립 Loop를 재생성하지 않고 현재 leesh-loop 배포본에 맞게 업데이트할 수 있도록 한다.

Runtime과 workflow를 독립적으로 업데이트할 수 있게 하고, npm lockfile을 함께 관리하여 생성 및 업데이트된 Loop의 의존성 설치를 재현 가능하게 한다.

## Intent

- 기존 `init`에는 독립 Loop를 생성하는 기능만 있고, 생성 이후 runtime을 갱신하는 경로가 없다.
- 생성된 Loop의 프로젝트별 설정과 실행 상태는 유지하면서 leesh-loop의 변경 사항을 받아오고 싶다.
- Workflow는 프로젝트별로 수정될 수 있으므로 일반 runtime 업데이트에서는 유지한다.
- Workflow만 upstream 기준으로 교체하고 싶을 때는 `update --workflow`를 별도로 실행한다.
- `--workflow`는 명시적 교체 승인이다. 기존 workflow의 로컬 수정 여부와 무관하게 덮어쓴다.
- Runtime 파일도 leesh-loop가 소유하는 영역이므로 변경 사항을 병합하지 않고 배포본 기준으로 교체한다.
- `project.toml`과 환경 파일은 개별 Loop의 설정 영역이다. 이번 업데이트 기능에서 명시적으로 제외하고, 향후 변경 필요성이 생기면 별도로 다룬다.
- npm 의존성은 lockfile 기준으로 일관되게 관리하고 runtime 업데이트 시 함께 갱신한다.
- Lockfile 도입과 업데이트 기능은 책임이 다르지만 직접적인 선후 관계가 있으므로 하나의 계획에서 처리한다.
- 검증은 가능한 한 `/tmp` 아래 격리된 생성본을 이용하며 실제 사용 중인 Loop나 외부 서비스를 변경하지 않는다.

## Verification Requirements

### 1. 업데이트 명령

- 생성된 Loop 루트에서 `leesh-loop update`를 실행하면 현재 설치된 leesh-loop 배포본의 runtime으로 갱신된다.
- `leesh-loop update --workflow`는 workflow만 현재 배포본 기준으로 교체한다.
- 두 업데이트는 서로 독립적이며 실행 순서와 관계없이 각각의 관리 범위만 변경한다.
- 두 명령 모두 동일한 배포본을 다시 적용할 수 있다.
- 지원하지 않는 명령이나 옵션은 변경 없이 실패한다.

### 2. Runtime 업데이트

- 현재 배포본의 runtime-owned 파일을 반영한다.
- 이전 배포본에서 제거된 runtime-owned 파일도 정리한다.
- Runtime-owned 파일의 로컬 변경은 보존하거나 병합하지 않는다.
- 기본 업데이트는 `WORKFLOW.md`를 변경하지 않는다.
- 설정 파일, 환경 파일, workspace, state 및 기타 instance-owned 데이터는 변경하지 않는다.
- 업데이트한 Loop는 최초 생성에 사용한 source checkout 없이 실행할 수 있다.

### 3. Workflow 업데이트

- `update --workflow`는 현재 배포본의 workflow 생성 규칙에 따라 `WORKFLOW.md`를 교체한다.
- 로컬 수정 여부를 검사하거나 병합하지 않고 덮어쓴다.
- Runtime-owned 파일, npm package/lockfile, 설정 파일 및 영속 상태는 변경하지 않는다.
- 기존 runtime을 업데이트하지 않고도 workflow만 갱신할 수 있다.

### 4. 업데이트 대상에서 제외되는 파일

다음 파일은 모든 업데이트 모드의 관리 범위에서 제외한다.

- `project.toml`
- `.env`
- `.env.example`

이 파일에 대해 다음을 보장한다.

- 기존 내용과 존재 여부를 유지한다.
- 재생성, 덮어쓰기, 병합 또는 자동 마이그레이션을 수행하지 않는다.
- 새로운 설정값이나 환경 변수를 자동으로 추가하지 않는다.
- 업데이트 가능 여부나 실행 호환성을 판단하기 위한 읽기는 허용하지만 수정하지 않는다.

설정 스키마나 환경 변수의 향후 변경에 따른 갱신 정책은 이번 범위에 포함하지 않는다.

### 5. npm 의존성 재현성

- leesh-loop 소스 및 generated Loop의 npm 패키지는 각자의 `package.json`에 일치하는 `package-lock.json`을 가진다.
- `init`은 generated Loop 루트에 일치하는 package manifest와 lockfile을 생성한다.
- Runtime 업데이트는 관리 대상 package manifest와 lockfile을 함께 갱신한다.
- npm 의존성 설치는 lockfile을 기준으로 재현할 수 있어야 한다.
- 의존성 설치 과정에서 lockfile이 임의로 갱신되지 않는다.
- Workflow 전용 업데이트는 npm 의존성에 영향을 주지 않는다.
- 기존 Symphony의 Mix 의존성 관리 계약은 유지된다.

### 6. 설치 식별과 기존 Loop 지원

- 새로 생성된 Loop는 설치 여부와 마지막으로 적용한 runtime 및 workflow 배포본을 식별할 수 있다.
- 업데이트는 기존에 관리하던 파일과 현재 배포본의 관리 파일을 구분하여 추가·교체·삭제 대상을 결정할 수 있다.
- Runtime과 workflow의 업데이트 이력은 독립적으로 유지된다.
- 업데이트용 설치 정보가 없는 기존 generated Loop도 기존 `init` 생성 구조를 통해 소유 범위를 안전하게 판별할 수 있으면 갱신할 수 있다.
- 소유 범위를 확인할 수 없는 디렉터리나 설치본은 변경하지 않고 거부한다.
- 설치 정보는 성공적으로 반영된 결과와 일치해야 한다.

### 7. 업데이트 안전성

- 업데이트 전 대상 Loop, source 및 변경 대상의 유효성을 검증한다.
- 사전에 발견할 수 있는 오류는 기존 설치를 변경하기 전에 실패한다.
- Instance-owned 파일이나 관리 대상에 예상하지 못한 경로 충돌이 있으면 임의로 교체하지 않는다.
- Symlink를 따라가서 관리 경계 외부의 파일을 변경하지 않는다.
- 적용 도중 실패해도 완료되지 않은 업데이트를 성공으로 기록하지 않는다.
- 중간 실패가 발생하면 오류와 남은 적용 상태를 확인하고 안전하게 재시도할 수 있어야 한다.
- 업데이트 실패로 인해 설정, 인증 정보, workspace 및 state가 손상되지 않는다.
- 업데이트 과정에서 외부 Service를 시작하거나 중지하지 않는다.
- 대상 Git 저장소의 파일과 Git 상태를 변경하지 않는다.

### 8. 기존 동작 유지

- 기존 `init`의 생성 위치, 대상 Git upstream 선택, 이름 충돌 처리 및 source checkout 독립성 계약을 유지한다.
- Generated Loop의 `npm start` 및 `npm stop` 진입점을 유지한다.
- Runtime 업데이트 후 기존 `project.toml`을 사용해 기동할 수 있어야 한다.
- Workflow 전용 업데이트 이후 기존 runtime을 그대로 실행할 수 있어야 한다.

## Definitions

- **배포본(Distribution)**: 현재 설치된 `leesh-loop` CLI가 참조하는 소스와 관리 대상 자산.
- **Generated Loop**: `leesh-loop init`으로 생성한 독립 Loop 디렉터리.
- **Runtime snapshot**: Runtime manifest가 선택한 leesh-loop 소유 파일 집합.
- **Runtime-owned 파일**: 일반 업데이트에서 leesh-loop가 교체하거나 제거할 수 있는 파일.
- **Instance-owned 파일**: 개별 Loop의 설정, 인증 정보 또는 영속 데이터를 보유하며 업데이트 관리 대상에서 제외되는 파일.
- **Workflow**: Generated Loop 루트의 `WORKFLOW.md`에 생성되는 worker 실행 계약.
- **설치 정보(Installation metadata)**: Generated Loop의 설치 식별과 마지막으로 적용한 배포본 및 managed 파일 집합을 나타내는 정보.
- **Legacy Loop**: 업데이트용 설치 정보가 추가되기 전에 생성된 Loop.

## Decisions

### 1. 명령 인터페이스

| 명령 | 책임 |
|---|---|
| `leesh-loop init` | 독립 Loop 생성 |
| `leesh-loop update` | Runtime 및 npm 의존성 정의 갱신 |
| `leesh-loop update --workflow` | Workflow만 갱신 |

- `update`는 generated Loop 루트에서 실행한다.
- 대상 Git checkout이나 최초 source checkout은 필요하지 않다.
- `--workflow`는 독립적인 업데이트 모드이며 runtime 업데이트와 결합되지 않는다.
- `--dry-run`, `--force`, 버전 선택, 자동 merge 및 rollback 명령은 도입하지 않는다.

### 2. Runtime 소유 범위

기존 `operator/app/runtime-manifest.mjs`를 runtime-owned 파일 선택의 단일 authority로 유지한다.

- 현재 manifest는 Git 추적 파일의 허용 목록으로 runtime snapshot을 생성한다.
- 이전 managed 파일 집합을 식별하여 제거된 파일도 처리한다.
- Instance-owned 파일을 runtime snapshot 교체 경계에 포함하지 않는다.
- Runtime-owned 파일의 로컬 수정 여부는 업데이트 동작을 결정하지 않는다.
- 전체 generated Loop 디렉터리를 삭제하거나 `init`을 재실행하는 방식은 사용하지 않는다.

### 3. 설치 정보

- 새 generated Loop에는 최소한의 설치 정보를 기록한다.
- Runtime과 workflow의 적용 배포본을 구분한다.
- 제거 대상을 식별하는 데 필요한 managed 파일 집합을 기록한다.
- 기존 패키지 버전과 배포 자산 식별을 활용하되, 버전 문자열만으로 파일 내용이 동일하다고 가정하지 않는다.
- 업데이트 성공 시 해당 영역의 설치 정보만 갱신한다.
- 파일별 로컬 변경 이력, 자동 merge 및 일반적인 migration framework는 도입하지 않는다.

Legacy Loop는 기존 `init` 구조를 이용해 관리 범위를 확인한다. 안전하게 확인할 수 없으면 실패한다.

### 4. Workflow 생성 책임

- 현재 `init`의 workflow 생성 규칙을 재사용한다.
- `docs/WORKFLOW_TEMPLATE.md`와 생성 workflow의 runtime configuration을 함께 반영한다.
- 단순히 template 파일만 복사하지 않는다.
- 현재 `project.toml`의 workflow 경로가 기본 생성 위치와 다르면 다른 경로를 임의로 덮어쓰지 않는다.

### 5. npm lockfile 관리

현재 저장소에는 다음 lockfile이 이미 존재하며 runtime manifest에 포함된다.

- `operator/ui/package-lock.json`
- `operator/notion_publisher/package-lock.json`

추가로 다음을 관리한다.

- leesh-loop 소스 루트 패키지의 lockfile
- Generated Loop 루트 패키지의 lockfile

두 루트 패키지는 서로 다른 package manifest를 가진다.

- 소스 루트 `package.json`은 leesh-loop 개발 및 CLI 패키지 정의를 유지한다.
- Generated Loop 루트 `package.json`은 현재의 인스턴스별 package name과 start/stop scripts를 유지한다.
- 각 lockfile은 해당 package manifest와 일치하도록 관리한다.
- npm 패키지 설치는 `npm ci`를 기준으로 정리한다.
- 일반적인 dependency upgrade, audit remediation, Mix 의존성 버전 변경은 범위에 포함하지 않는다.

### 6. 적용 및 실패 처리

- 적용 전 현재 설치와 source의 관리 대상을 확인한다.
- 파일 교체에 필요한 source를 먼저 검증한다.
- 삭제 대상은 기존 leesh-loop-managed 파일에 한정한다.
- 중간 실패 이후에도 실제 변경 상태를 판별하고 재시도할 수 있도록 한다.
- 설치 정보를 실제 파일 반영보다 먼저 갱신하지 않는다.
- 업데이트는 Loop를 정지한 상태에서 실행하는 운영 작업으로 취급한다.
- 실행 중 업데이트의 무중단 보장이나 자동 재시작 기능은 제공하지 않는다.
- 범용 rollback 또는 별도 버전 migration 체계는 도입하지 않는다.

### 7. Protected scope 및 명명

다음 파일은 업데이트의 명시적인 관리 범위 밖이다.

| 파일 | `update` | `update --workflow` |
|---|---|---|
| `project.toml` | 보존 | 보존 |
| `.env` | 보존 | 보존 |
| `.env.example` | 보존 | 보존 |
| `WORKFLOW.md` | 보존 | 교체 |
| Runtime-owned 파일 | 갱신 | 보존 |
| npm package/lockfile | 갱신 | 보존 |
| Workspace/state | 보존 | 보존 |

`project.toml`과 환경 파일의 스키마 변경, 기본값 동기화 및 마이그레이션은 별도 계획에서 결정한다.

다음 기존 책임도 변경하지 않는다.

- Publisher, Notion task lifecycle 및 worker dispatch
- Human Review와 Merging 계약
- `chatgpt-shot` Service 실행 및 discovery
- E2E harness의 데이터베이스 풀과 run 격리
- Workspace materialization과 대상 저장소 Git 작업
- 기존 Symphony Mix 의존성 관리

파일, 모듈, 타입 및 주요 함수 이름은 현재 책임과 역할을 표현한다. 아직 존재하지 않는 추상화나 향후 확장을 전제로 이름을 짓지 않는다.

### 8. Planned units

**Unit A — 재현 가능한 독립 Loop 배포**

npm package manifest와 lockfile을 일관되게 관리하고, `init`이 설치 정보가 포함된 독립 Loop를 생성하도록 한다.

완료 결과: 새 generated Loop에 유효한 설치 기준점과 lockfile이 존재하고, 의존성 설치를 재현할 수 있다.

**Unit B — 독립 Loop 업데이트**

기존 generated Loop에서 runtime과 workflow를 독립적으로 갱신하며, 사용자 소유 파일과 영속 상태를 보존한다.

완료 결과: Runtime 업데이트와 workflow 전용 업데이트가 실제 generated Loop에서 동작하고, 관리 대상과 보존 대상이 명확히 분리된다.

Unit B는 Unit A에서 확정한 설치 정보와 lockfile 관리 계약을 사용한다.

## Verification

### 1. 격리 환경

`/tmp` 아래 테스트 전용 디렉터리에 대상 Git 저장소와 generated Loop를 생성한다.

- 기존 init 테스트의 임시 디렉터리 패턴을 재사용한다.
- 대상 저장소에는 테스트용 로컬 Git upstream을 구성한다.
- 이전 배포본과 현재 배포본을 분리한 fixture를 구성한다.
- 테스트 전용 HOME, XDG 경로 및 npm 캐시를 사용한다.
- 실제 사용 중인 Loop와 외부 Service는 변경하지 않는다.
- 테스트가 생성한 자산만 정리한다.

### 2. Init 및 npm 의존성

실제 `leesh-loop init`을 실행한 뒤 생성 결과를 확인한다.

- Generated Loop의 package manifest와 lockfile이 일치한다.
- Runtime snapshot에 기존 npm 패키지별 lockfile이 포함된다.
- 각 npm 패키지에서 `npm ci`가 성공한다.
- 생성된 Loop의 설치 정보를 읽을 수 있다.
- 기존 workflow와 프로젝트 설정이 정상적으로 생성된다.
- 대상 Git 저장소는 변경되지 않는다.

### 3. Runtime 업데이트

이전 배포본으로 생성한 Loop에 다음 상태를 구성한다.

- 로컬 수정된 runtime-owned 파일
- 현재 배포본에서 제거되는 managed 파일
- 현재 배포본에서 새로 추가되는 managed 파일
- 수정된 `WORKFLOW.md`
- 수정된 `project.toml`, `.env`, `.env.example`
- 기존 workspace 및 state

현재 배포본의 CLI로 `leesh-loop update`를 실행한다.

확인할 증거:

- Runtime-owned 파일이 현재 배포본과 일치한다.
- 새 파일이 추가되고 이전 managed 파일이 제거된다.
- Package manifest와 lockfile이 일치한다.
- `npm ci`로 의존성을 설치할 수 있다.
- `WORKFLOW.md`는 변경되지 않는다.
- `project.toml`, `.env`, `.env.example`은 바이트 단위로 동일하다.
- Workspace 및 state가 유지된다.
- Runtime 설치 정보만 현재 배포본 기준으로 갱신된다.
- 대상 Git 저장소가 변경되지 않는다.
- 동일한 업데이트를 재실행할 수 있다.

### 4. Workflow 업데이트

생성된 Loop의 `WORKFLOW.md`를 수정한 뒤 `leesh-loop update --workflow`를 실행한다.

확인할 증거:

- 결과가 현재 배포본의 전체 generated workflow와 일치한다.
- 기존 로컬 수정이 교체된다.
- Runtime-owned 파일과 npm package/lockfile은 변경되지 않는다.
- `project.toml`, `.env`, `.env.example`은 변경되지 않는다.
- Workspace 및 state가 유지된다.
- Workflow 설치 정보만 갱신된다.
- 동일 명령을 반복 실행할 수 있다.

Runtime 업데이트 전후에 workflow 업데이트를 각각 실행하여 두 모드의 독립성을 확인한다.

### 5. 기존 설치와 잘못된 입력

- 설치 정보가 없는 기존 `init` 생성본의 구조와 관리 범위를 확인한다.
- 안전하게 식별 가능한 기존 생성본에서 업데이트를 실행한다.
- 식별할 수 없는 일반 디렉터리는 변경 없이 거부되는지 확인한다.
- 잘못된 source, 누락된 managed 파일, 경로 충돌 및 지원하지 않는 CLI 옵션에 대한 실패 결과를 확인한다.
- 사용자 소유 파일과 충돌한 경우 내용이 보존되는지 확인한다.

### 6. 실패 및 안전성

- Source 검증 실패 시 기존 파일이 변경되지 않는지 확인한다.
- Symlink 충돌 시 경계 외부의 대상이 변경되지 않는지 확인한다.
- 파일 적용 중 실패를 유도하고 실제 적용 상태 및 설치 정보가 일치하는지 확인한다.
- 실패 후 재시도하여 정상 배포본으로 수렴할 수 있는지 확인한다.
- 실패 후 `project.toml`, 환경 파일, workspace 및 state가 유지되는지 확인한다.
- 업데이트 과정에서 외부 Service를 실행하거나 중지하지 않는지 확인한다.
- 대상 Git 저장소의 파일과 Git 상태가 변경되지 않는지 확인한다.

### 7. 독립 실행 경로

`/tmp`에 생성한 Loop에서 실제 CLI와 production runtime 진입점을 사용한다.

- 원본 source checkout에 의존하지 않는지 확인한다.
- Runtime 업데이트 후 기존 `project.toml`을 사용해 의존성을 준비한다.
- 필요한 npm 및 Mix dependency 준비 경로를 확인한다.
- Operator의 로컬 기동, 응답 및 종료를 확인한다.
- Workflow 전용 업데이트 이후에도 기존 runtime 진입점이 유지되는지 확인한다.

외부 연동은 격리된 테스트 환경 또는 대체 구현을 사용한다. 실제 Notion 데이터베이스와 `chatgpt-shot` Service를 변경하지 않는다.

실제 외부 작업 dispatch까지의 운영 readiness는 이번 업데이트 기능의 완료 조건에 포함하지 않는다.

### 8. 기존 회귀 검증

- 기존 init 테스트
- Operator 및 관련 runtime 테스트
- npm 패키지별 빌드와 테스트
- 생성·기동 경계에 영향을 받는 기존 E2E 테스트
- Runtime manifest와 최종 변경 범위 비교
- `git diff --check`
- Objective, Intent 및 Verification Requirements와 최종 결과 비교

## Verification Tools

| 도구 / 메커니즘 | 검증 대상 |
|---|---|
| `node --test` | Init, Update, 관리 경계, 설치 정보 및 실패 처리 |
| 실제 `leesh-loop` CLI | 명령 인터페이스와 생성본 갱신 |
| `mkdtemp` / `/tmp` | 테스트 저장소, generated Loop, 이전·현재 배포본 격리 |
| `git` | Runtime manifest, 파일 변경 및 대상 저장소 불변성 |
| `npm ci` | Lockfile 기반 의존성 재현 |
| `npm run build` / 패키지별 테스트 | 설치된 npm 의존성의 사용 가능성 |
| `mise exec` / `mix` | 기존 Symphony 의존성 준비 |
| `npm start` / `npm stop` | Generated Loop의 runtime 기동 경로 |
| 파일 및 설치 정보 readback | 추가·교체·삭제·보존·실패 결과 |
| 기존 E2E harness | 관련 기존 실행 경계 회귀 검증 |
