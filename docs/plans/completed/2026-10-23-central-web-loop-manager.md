# 2026-10-23-central-web-loop-manager

## Objective

Leesh Loop를 사용자 단위의 중앙 웹 Manager 구조로 전환한다.

사용자는 하나의 브라우저 UI에서 여러 Loop Instance를 생성, 조회, 시작, 종료하고, 기존 Operator의 Task 관리 기능과 Runtime 및 Workflow 업데이트를 사용할 수 있어야 한다.

공통 Runtime은 중앙에서 관리하고, 각 Loop Instance의 설정·작업 데이터·실행 환경은 독립적으로 유지한다.

브라우저와 Manager Service의 종료·재시작이 이미 실행 중인 Loop Process 및 Worker Session의 작업 수행에 영향을 주지 않도록 한다.

Manager와 Worker 실행 구현의 책임을 분리하여, 이후 Codex app-server 및 sandbox 실행 방식 변경이 중앙 관리 구조의 재설계를 요구하지 않도록 한다.

## Intent

현재는 `leesh-loop init`가 프로젝트별 Runtime을 생성하고, 사용자가 포트를 설정하며, 개별 인스턴스에서 실행과 업데이트를 관리해야 한다.

이러한 운영 부담을 중앙 Manager가 담당하도록 변경한다.

중앙 웹 UI를 기본 관리 인터페이스로 사용하고, CLI는 초기화와 자동화에 필요한 진입점으로 유지한다.

Manager는 Loop 실행을 관리하지만 Worker 작업을 수행하는 필수 중계 서버가 아니다. Manager가 실행되지 않아도 이미 시작된 Loop의 작업은 계속되어야 한다.

기존 인스턴스의 마이그레이션은 필요하지 않다. 새 구조로 전환하면 이전 `leesh-loop list`의 항목들이 새 관리 목록에 나타나지 않을 수 있으며, 사용자는 필요한 저장소에서 다시 `init`한다. 기존 파일과 데이터는 보존한다.

이번 작업에서는 기존 Symphony의 Task orchestration, Codex app-server 및 sandbox 동작을 변경하지 않는다.

## Verification Requirements

### VR-1. 중앙 설치 및 인스턴스 관리

- 공통 Runtime 코드와 의존성을 사용자 단위에서 관리하며, 인스턴스 생성 시 복제하지 않는다.
- CLI와 중앙 웹 UI에서 새 Loop Instance를 생성하고 관리할 수 있다.
- 각 인스턴스는 안정적인 식별자와 독립적인 설정, Workflow, SQLite 및 Workspace를 가진다.
- 일반적인 초기화 과정에서 불필요한 `.env.example`을 생성하지 않는다.
- 인스턴스 생성과 중앙 Runtime 설치·업데이트는 기존 형식의 Loop 파일이나 데이터를 변경하지 않는다.

### VR-2. 실행 생명주기 독립성

- 브라우저 종료·새로고침은 Manager Service와 Loop Process를 종료하지 않는다.
- Manager Service 종료·재시작은 이미 실행 중인 Loop Process 및 Worker Session을 중단하지 않는다.
- Manager가 없는 동안에도 Loop는 Task 조회·변경, Worker 실행, Workpad 기록 등 기존 작업을 계속 수행할 수 있다.
- Manager 재시작 후 살아 있는 Loop를 정확하게 재발견하고 제어할 수 있다.
- Loop Process 종료는 Manager나 다른 Loop Process를 종료하지 않는다.
- 시스템 재부팅 후 지속 데이터가 보존된다. 자동 재시작은 요구하지 않는다.

### VR-3. 프로세스 및 포트 관리

- Manager는 관리 대상 Loop Process의 실제 신원과 상태를 확인하여 시작·종료한다.
- PID 재사용, 오래된 기록, 시작 실패, 비정상 종료 또는 신원 불일치 상황에서 다른 프로세스를 잘못 제어하지 않는다.
- 인스턴스별 내부 서버는 설정된 포트 범위에서 사용 가능한 포트를 자동 할당받는다.
- 동시 시작이나 다른 프로세스의 포트 점유로 인한 충돌을 안전하게 처리한다.
- 사용자는 일상적인 실행을 위해 `project.toml`에서 포트를 직접 수정할 필요가 없다.
- 실행 실패, 종료 실패 및 확인 불가능한 상태를 실제 결과와 구분하여 보고한다.

### VR-4. 중앙 웹 Operator 및 CLI

- 하나의 Manager 웹 주소에서 모든 관리형 인스턴스의 목록, 프로젝트 정보, 실행 상태, 로그 및 작업에 접근한다.
- 기존 Operator의 Accepted Plan 발행, Task 목록·상세, State, Blocked By, 댓글, Workpad 및 Human Review 관련 기능의 의미를 유지한다.
- Loop Process가 중지되어 있어도 허용된 Task 관리 기능을 사용할 수 있다.
- 각 요청과 변경은 선택한 인스턴스의 데이터에만 적용된다.
- CLI의 `init`, `list`, `start`, `stop`과 중앙 웹 UI는 동일한 관리 상태와 실행 결과를 사용한다.
- `leesh-loop` 명령으로 Manager 웹 UI에 접근할 수 있으며, Manager가 실행 중이지 않아도 필요한 서비스를 시작할 수 있다.
- 브라우저 UI는 실제 실행 상태와 변경 결과를 명확하고 이해하기 쉽게 표시한다.

### VR-5. 중앙 Runtime 업데이트

- 공통 Runtime을 중앙에서 설치하고 업데이트할 수 있다.
- 실행 중인 Loop는 시작 시 선택된 Runtime 코드와 의존성을 유지한다.
- 중앙 Runtime 또는 Manager Service 업데이트가 실행 중인 Loop를 중단하지 않는다.
- 업데이트 후 새로 시작하는 Loop는 적용 가능한 새 Runtime을 사용한다.
- 업데이트 실패 시 기존 유효 Runtime과 실행 중인 Loop를 보존한다.
- 서로 다른 버전의 Manager와 Loop가 데이터를 공유할 때 호환성이 확인되지 않은 변경이나 마이그레이션을 수행하지 않는다.
- 사용 중인 Runtime 버전은 실행 프로세스가 참조하는 동안 제거하지 않는다.

### VR-6. Workflow 관리

- 중앙 웹 UI에서 인스턴스별 현재 Workflow와 업데이트할 템플릿의 차이를 확인할 수 있다.
- Runtime 업데이트와 Workflow 업데이트는 독립적으로 수행한다.
- Workflow 업데이트는 명시적으로 선택한 인스턴스에만 적용한다.
- 실행 중인 Loop의 Workflow는 변경하지 않는다.
- 사용자 수정 내용은 명시적 승인 없이 덮어쓰지 않는다.
- 업데이트 실패 시 이전 Workflow 내용을 보존하거나 복구할 수 있다.

### VR-7. 기존 Worker 실행 계약 보존

- 기존 Symphony의 Task dispatch, Workspace, 재시도, Worker 실행 및 Task 상태 전이 의미를 유지한다.
- 기존 Local Task Store와 Worker-facing 도구의 계약을 유지한다.
- Codex app-server의 thread, turn, approval 및 sandbox 정책은 변경하지 않는다.
- Manager의 인스턴스 관리·실행 제어는 Codex 내부 세션 프로토콜이나 sandbox 정책에 직접 의존하지 않는다.

### VR-8. 보안 및 데이터 보호

- Manager 웹 서비스는 로컬 사용자 환경에서만 접근하도록 보호한다.
- 외부 웹사이트나 승인되지 않은 요청이 관리 명령을 실행할 수 없어야 한다.
- API는 허용된 관리 작업만 제공하며 클라이언트 입력을 임의 셸 명령으로 실행하지 않는다.
- 경로와 프로세스 소유권을 검증하여 관리 대상 밖의 파일이나 프로세스를 변경하지 않는다.
- 여러 인스턴스의 Task Store 및 실행 상태가 서로 혼동되지 않는다.
- 실패한 관리 작업이 기존 작업 데이터나 실행 상태를 손상시키지 않는다.

## Definitions

| Term | Meaning |
|---|---|
| **Manager UI** | 중앙 관리 기능을 표시하는 브라우저 인터페이스 |
| **Manager Service** | 인스턴스·프로세스·포트·업데이트·Task 관리 API를 제공하는 로컬 서비스 |
| **Loop Instance** | 특정 Git 저장소에 연결되고 고유 ID, 설정, Workflow 및 지속 데이터를 소유하는 논리적 Loop |
| **Loop Process** | 특정 Loop Instance의 Symphony 및 Worker 실행을 담당하는 독립 OS 프로세스 |
| **Worker Session** | 개별 Task를 수행하기 위한 Loop 내부 실행 세션 |
| **Runtime Distribution** | Loop 실행 코드 및 의존성의 특정 버전 |
| **Active Runtime** | 새 Loop Process 시작 시 기본으로 사용할 Runtime Distribution |
| **Workflow** | 인스턴스가 소유하는 `WORKFLOW.md` 실행 계약 |
| **Execution Record** | Loop Process 신원, Runtime 버전, 포트 및 실행 상태를 기록하는 정보 |

Loop Instance는 지속 데이터와 식별자를 소유하는 대상이며, Loop Process는 필요할 때 시작·종료되는 실행 대상이다.

Manager UI, Manager Service, Loop Process는 서로 다른 생명주기를 가진다.

## Decisions

### 1. 중앙 관리 책임

Manager Service는 다음을 담당한다.

- Loop Instance 생성, 등록 및 조회
- Loop Process 시작·종료와 실행 상태 확인
- 내부 서버 포트 자동 관리
- 중앙 Runtime 설치와 업데이트
- 인스턴스별 Workflow 관리
- 기존 Operator의 Task 관리 API
- 실행 로그와 오류 정보 제공

Loop Process는 실제 Worker 실행과 Task 처리에 필요한 기능을 자체적으로 유지한다.

Manager Service는 작업 실행의 필수 중계자로 동작하지 않는다.

Manager API와 Worker 내부 실행 API를 혼합하지 않는다.

### 2. Runtime 코드와 인스턴스 데이터 분리

공통 Runtime과 인스턴스 지속 데이터의 경로를 분리한다.

사용자 단위 XDG 디렉터리를 기본으로 사용한다.

- Data: 인스턴스 설정, Workflow, SQLite, Workspace
- State: 실행 기록, Manager 상태, 로그
- Config: 중앙 사용자 설정
- Runtime: 공통 코드와 의존성

인스턴스별 Runtime 소스 복제는 생성하지 않는다.

현재 소스 디렉터리를 기준으로 Runtime 코드와 인스턴스 상태를 함께 추론하는 실행 경로는 두 책임을 구분하도록 변경한다.

파일·모듈·타입·주요 함수 이름은 실제 책임을 반영한다. 미래 실행 엔진을 가정한 범용 추상화는 도입하지 않는다.

### 3. 기존 인스턴스 처리

새 구조는 자체 인스턴스 저장소를 사용한다.

기존 Registry를 이용한 인스턴스 발견 및 실행 경로는 계승하지 않으며, 기존 인스턴스 마이그레이션은 구현하지 않는다.

따라서 기존 `leesh-loop list`에 나타나던 인스턴스는 새 목록에서 자동으로 승계되지 않는다. 이는 관리 저장소 변경에 따른 예상 결과이지, 별도로 구현해야 하는 단절 기능이 아니다.

기존 Registry, 인스턴스 디렉터리, SQLite 및 Workspace는 자동으로 변경하거나 삭제하지 않는다. 실행 중인 기존 프로세스도 전환 때문에 종료하지 않는다.

사용자는 기존 작업을 마무리하고 필요한 Git 저장소에서 새 인스턴스를 초기화한다.

기존 형식 인식, 전용 오류, 자동 가져오기, 등록 정보 병합 또는 특별한 연결 차단 기능은 구현하지 않는다.

### 4. 인스턴스 생성 및 CLI

`leesh-loop init`는 현재 Git 저장소를 대상으로 중앙 관리형 인스턴스를 생성한다.

웹 UI에서도 사용자가 지정한 로컬 Git 저장소 경로를 검증하여 인스턴스를 생성할 수 있다.

동일한 관리 대상을 실수로 중복 생성하거나 데이터를 덮어쓰지 않도록 한다.

CLI와 웹 UI는 같은 관리 계층을 사용한다.

인스턴스 목록의 표시 순서나 임시 번호는 영속 식별자가 아니다.

Manager Service가 실행 중이 아니면 기본 `leesh-loop` 명령으로 시작할 수 있다. CLI 종료가 Manager나 Loop Process의 종료를 의미하지 않는다.

### 5. Manager와 Loop의 프로세스 경계

Loop Process는 Manager Service와 독립적으로 실행한다.

Manager 재시작 시 Execution Record와 실제 프로세스 신원을 확인해 실행 상태를 복원한다.

프로세스 존재만으로 Running을 판단하지 않고, 소유권과 필요한 실행 준비 상태를 확인한다.

실행 상태는 적어도 다음 의미를 구별한다.

- **Stopped:** 종료가 확인됨
- **Starting:** 시작 중이며 준비 완료 전
- **Running:** 소유권과 실행 준비가 확인됨
- **Stopping:** 종료 진행 중
- **Unconfirmed:** 프로세스 신원 또는 실행 상태를 확정할 수 없음
- **Failed:** 시작 또는 실행 실패가 확인됨

상태가 불확실하면 무리하게 재시작하거나 종료하지 않고 원인을 표시한다.

프로세스 관리 구현은 이 계약을 충족하는 범위에서 선택한다. 특정 OS 서비스 관리자 사용을 필수로 하지 않는다.

### 6. 중앙 포트 관리

Manager UI는 단일 로컬 웹 주소를 사용한다. 인스턴스마다 별도의 Operator UI 서버를 실행하지 않는다.

인스턴스별 Symphony 서버 등 실제로 필요한 내부 포트만 자동 할당한다.

프로젝트 설정에 있는 기존 `ui_port` 및 `symphony_port` 의존성은 중앙 관리 책임에 맞게 정리한다.

Manager는 설정된 범위에서 포트를 배정하고 실제 서버 시작 결과를 확인한다.

Manager 재시작 후 기존 프로세스의 포트 점유를 복원하며, 다른 프로세스가 사용 중인 포트를 임의로 회수하지 않는다.

포트가 부족하거나 충돌이 해결되지 않으면 해당 인스턴스의 시작을 실패 처리하고 원인을 표시한다.

### 7. 중앙 Operator와 Local Task Store

기존 Operator의 단일 프로젝트 전제를 여러 인스턴스 중 하나를 선택하는 모델로 전환한다.

Task 조회와 변경은 요청의 Instance ID에 따라 해당 인스턴스의 권위 있는 Local Task Store에서 수행한다.

Manager와 Loop Process의 동시 SQLite 접근은 기존 저장소의 트랜잭션 및 일관성 의미를 보존해야 한다.

Loop Process가 중지된 상태에서도 중앙 Operator가 지속 데이터를 읽고 허용된 변경을 수행할 수 있다.

서로 다른 Runtime 버전 사이의 저장 데이터 호환성이 확인되지 않으면 위험한 변경을 거부하고 그 이유를 표시한다.

Manager의 필요 때문에 Worker의 Task Store 접근을 중앙 웹 API로 강제 이전하지 않는다.

### 8. Runtime 업데이트 및 버전 보호

Runtime Distribution은 버전별로 불변 상태를 유지한다.

실행 중인 Loop Process는 시작 당시의 Runtime Distribution을 계속 사용한다.

새 Runtime 설치와 Active Runtime 전환은 이후 시작되는 Loop에 반영한다.

Manager Service 자체의 업데이트가 필요한 경우에도 이미 실행 중인 Loop를 종료하지 않는다.

업데이트 실패 시 기존 유효 버전을 유지한다.

현재 사용 중인 Runtime Distribution은 삭제하지 않는다.

데이터 스키마 변경은 실행 중인 구버전 Loop에 암묵적으로 적용하지 않는다. 호환성을 확인할 수 없는 인스턴스의 관련 작업은 명시적으로 제한한다.

자동 업데이트 예약, 임의의 버전 간 데이터 변환 및 일반적인 플러그인 호환성 시스템은 이번 범위에 포함하지 않는다.

### 9. Workflow 업데이트

Workflow는 Runtime Distribution이 아닌 Loop Instance가 소유한다.

Manager UI에서 현재 Workflow와 업데이트 내용을 비교하고, 사용자가 명시적으로 적용한다.

실행 중인 Loop에는 적용하지 않는다.

수정된 Workflow의 교체는 사용자 확인을 요구하며, 적용 실패 시 기존 내용을 보존한다.

Runtime 업데이트는 Workflow를 자동으로 변경하지 않는다.

업데이트 예약과 자동 병합은 구현하지 않는다.

### 10. Worker 실행 구현 보호

현재 Symphony 내부의 AgentRunner, Codex app-server, Workspace, Worker-facing Task 도구 및 dispatch 동작은 유지한다.

Manager는 인스턴스 단위의 시작·종료·상태·로그·설정만을 실행 계약으로 사용한다.

Manager는 Codex `thread/start`, `turn/start`, approval 또는 sandbox 프로토콜을 직접 해석하거나 호출하지 않는다.

향후 Codex app-server 및 sandbox의 분리·제거는 별도 계획으로 다룬다.

### 11. 로컬 웹 서비스의 권한 경계

Manager Service는 루프백 인터페이스에만 바인딩한다.

관리 요청에 대해 적절한 인증, 요청 출처 및 Host 검증을 적용한다.

브라우저에서 임의 셸 명령을 실행하는 API를 제공하지 않는다.

인스턴스 식별자와 파일 경로는 서버에서 검증한다.

파괴적인 파일·프로세스 작업은 검증된 관리 대상에만 수행한다.

## Planned Units

### Unit 1 — Instance Management

**Responsibility:** 중앙 인스턴스 생성, 식별, 저장 및 CLI 통합.

**Outcome:** 사용자는 CLI 또는 웹 UI에서 관리형 인스턴스를 만들 수 있고, 각 인스턴스의 지속 데이터가 중앙 구조 아래 독립적으로 관리된다.

### Unit 2 — Lifecycle Management

**Responsibility:** 프로세스 시작·종료, 소유권, 상태 복원 및 포트 할당.

**Outcome:** 여러 Loop를 독립적으로 실행하고, Manager 종료 후에도 작업을 유지하며, Manager 재시작 시 정확한 실행 상태로 재연결할 수 있다.

### Unit 3 — Central Web Operator

**Responsibility:** 중앙 관리 인터페이스와 인스턴스별 Task 관리.

**Outcome:** 하나의 브라우저 주소에서 인스턴스와 작업을 관리하며 기존 Operator의 작업 의미가 보존된다.

### Unit 4 — Runtime Distribution Management

**Responsibility:** 공통 Runtime 설치, 버전 선택 및 업데이트.

**Outcome:** Runtime을 중앙에서 업데이트하면서 기존 Loop 실행과 지속 데이터를 보호한다.

### Unit 5 — Workflow Management

**Responsibility:** 인스턴스별 Workflow 확인 및 명시적 업데이트.

**Outcome:** 중앙 UI에서 Workflow를 안전하게 업데이트하고, Runtime 업데이트와 사용자 수정 내용을 독립적으로 관리한다.

## Verification

### V-1. 설치 및 인스턴스 관리

**Requirements:** VR-1, VR-4

**Evidence:**
- 격리된 사용자 환경과 두 개의 실제 Git 저장소에서 `init`를 수행한다.
- 생성된 데이터와 Runtime 경로를 확인한다.
- CLI와 웹 UI의 인스턴스 목록을 비교한다.
- 기존 Registry와 인스턴스 파일이 있는 환경에서도 새 구조를 실행한다.

**Pass:** 새 인스턴스가 정상 등록되고 Runtime이 복제되지 않으며, CLI와 UI가 같은 데이터를 표시한다. 기존 인스턴스의 파일과 프로세스는 변경되지 않는다.

**Failure:** 데이터 혼동, Runtime 복제, Registry 불일치 또는 기존 파일·프로세스 변경.

기존 등록 정보가 새 목록으로 승계되지 않는 것은 예상 결과로 확인하되, 이를 구현하기 위한 Legacy 전용 코드나 테스트 계약을 만들지 않는다.

### V-2. 생명주기 독립성

**Requirements:** VR-2, VR-3, VR-7

**Evidence:**
- 실제 Symphony와 제어 가능한 Worker를 사용하는 인스턴스 두 개를 실행한다.
- 작업 진행 중 브라우저와 Manager Service를 종료한다.
- Manager가 없는 동안 Task 처리와 Workpad 기록이 진행되는지 확인한다.
- Manager 재시작 후 기존 프로세스에 재연결하고 하나만 종료한다.

**Pass:** 작업이 계속 진행되고 기록이 유지되며, 재연결 후 대상 Loop만 정상적으로 제어된다.

**Failure:** Manager 종료에 따른 Worker 중단, 상태 오인식 또는 다른 Loop 종료.

### V-3. 프로세스 및 포트 실패 처리

**Requirements:** VR-3

**Evidence:**
- 다중 인스턴스 동시 시작을 수행한다.
- 포트 선점, 시작 실패, 비정상 종료, 오래된 PID 및 소유권 불일치를 재현한다.
- OS 프로세스·소켓 상태와 Manager 결과를 비교한다.

**Pass:** 유효한 포트를 사용하고 소유권이 확인된 프로세스만 제어한다. 불확실한 상태와 실패는 정확히 보고한다.

**Failure:** 중복 포트 할당, 잘못된 프로세스 종료, 무단 포트 회수 또는 거짓 성공 보고.

### V-4. 중앙 Operator

**Requirements:** VR-4, VR-8

**Evidence:**
- 실제 브라우저에서 인스턴스 생성·선택·시작·종료와 로그 조회를 수행한다.
- 두 인스턴스에서 Plan 발행, Task 조회, State 변경, Blocked By, 댓글 및 Human Review 흐름을 검증한다.
- 권위 있는 SQLite 결과를 비교한다.
- 중지된 Loop의 Task 관리와 실행 중 Loop와의 동시 접근을 확인한다.
- 일반 데스크톱과 좁은 화면에서 실제 UI를 조작하고 렌더링 결과를 확인한다.

**Pass:** 모든 관리 작업이 올바른 인스턴스에 적용되고 기존 작업 의미가 보존되며, 화면이 대상·상태·결과를 명확히 전달한다.

**Failure:** 데이터 혼동, Task 의미 변경, 동시 접근 오류 또는 주요 기능 사용 불가.

### V-5. Runtime 업데이트

**Requirements:** VR-2, VR-5

**Evidence:**
- Runtime v1에서 Loop A를 실행한다.
- A의 작업 진행 중 Runtime v2를 설치하고 활성화한다.
- Loop B를 새로 시작한다.
- Manager Service를 재시작한다.
- 실행 프로세스별 Runtime 버전과 Task Store 기록을 확인한다.
- 업데이트 실패 및 데이터 버전 불일치 상황을 시험한다.

**Pass:** A는 v1로 계속 실행되고 B는 적용 가능한 v2를 사용한다. 업데이트 실패와 호환성 불일치가 기존 실행·데이터를 손상시키지 않는다.

**Failure:** 실행 중 버전 교체, 데이터 손상, 기존 Loop 중단 또는 호환성 확인 없는 변경.

### V-6. Workflow 업데이트

**Requirements:** VR-6

**Evidence:**
- 사용자가 수정한 Workflow와 수정하지 않은 Workflow를 준비한다.
- 중앙 UI에서 업데이트 차이를 확인한다.
- 중지된 인스턴스에만 명시적으로 적용한다.
- 실행 중 적용, 사용자 확인 없는 교체 및 쓰기 실패를 시험한다.

**Pass:** 승인한 대상에만 업데이트가 적용되고 다른 Workflow는 유지된다. 실패 시 기존 내용이 보존된다.

**Failure:** 자동 덮어쓰기, 실행 중 변경, 다른 인스턴스 변경 또는 복구 불가능한 손상.

### V-7. Worker 실행 계약

**Requirements:** VR-7

**Evidence:**
- 기존 Symphony 및 Local Task Store 테스트를 수행한다.
- 대표적인 Worker 실행과 Task 상태 전이 경로를 검증한다.
- Manager의 실제 호출 경로가 Codex 내부 세션·sandbox API에 의존하지 않는지 확인한다.

**Pass:** 기존 Task 및 Worker 실행 의미가 유지되고 Manager의 책임이 인스턴스 수준에서 끝난다.

**Failure:** 기존 Worker 동작 변경 또는 Manager에 Codex 내부 프로토콜 결합 발생.

### V-8. 보안

**Requirements:** VR-8

**Evidence:**
- 외부 Origin, 부적절한 Host, 미승인 변경 요청을 시험한다.
- 잘못된 Instance ID와 경로, 관리 범위 밖 파일·프로세스를 대상으로 요청한다.
- 실제 브라우저에서 정상 관리 요청의 성공도 확인한다.

**Pass:** 정상적인 로컬 관리 작업은 수행되고 무단 요청과 범위 밖 조작은 거부된다.

**Failure:** 임의 명령 실행, 외부 요청에 의한 상태 변경 또는 다른 인스턴스의 파일·프로세스 조작.

### Verification limitations

제어 가능한 Worker를 사용하는 E2E는 Manager와 Loop의 생명주기 독립성 및 Task 상태 의미를 검증할 수 있지만, 실제 Codex app-server와 외부 서비스의 모든 동작을 입증하지는 않는다.

기존 실행 경로에 영향을 주는 변경은 가능한 실제 Codex·외부 서비스 smoke 검증으로 보완한다. 해당 환경을 사용할 수 없다면 검증하지 못한 범위와 남는 불확실성을 명시한다.

## Verification Tools

| Tool | Verification responsibility |
|---|---|
| Node.js 테스트 러너 | 인스턴스 관리, CLI, HTTP API, 포트·프로세스 제어 |
| Elixir `mix test` | Symphony 및 기존 Worker 실행 계약 |
| Local E2E harness | 실제 Loop 실행과 Task 상태 전이 |
| 격리된 XDG 사용자 환경 | 중앙 설치, 다중 인스턴스 및 기존 파일 보존 |
| OS 프로세스·소켓 관측 | 프로세스 생존, 소유권 및 포트 점유 |
| SQLite 직접 조회 | Task·Workpad·State의 권위 있는 저장 결과 |
| 실제 브라우저 검증 및 화면 캡처 | 중앙 UI의 조작·상태 전달·시각적 결과 |
| Codex 및 외부 서비스 smoke | 실제 Worker 실행과 외부 효과 보존 |
| Git diff·의존성 검토 | 기존 Worker 보호 범위 및 Manager 책임 경계 |

## Out of Scope

- 기존 인스턴스 마이그레이션과 Registry 호환 계층
- 기존 인스턴스 자동 삭제·정리
- TUI
- 원격 접속 및 다중 사용자 관리
- 여러 컴퓨터 간 동기화
- 로그인 시 Manager 또는 Loop 자동 실행
- Workflow 자동 병합 및 예약 업데이트
- Codex app-server 교체
- Sandbox 정책 변경·제거
- Symphony Task dispatch 정책 재설계
- 범용 Worker 실행 플러그인 시스템
