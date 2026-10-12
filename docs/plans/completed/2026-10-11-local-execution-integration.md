# 2026-10-11-local-execution-integration

## Objective

leesh-loop에서 기존 Notion 기반 실행 경로를 유지하면서 Local Task Store를 사용하는 별도의 작업 실행 경로를 구축한다.

새 경로에서 Accepted Plan 발행, Symphony의 Task 접수와 실행 대상 판단, Worker 작업 도구를 통한 Task 데이터 조회 및 상태·기록 변경이 정상적으로 이루어지도록 한다.

이를 검증하기 위해 실행마다 독립적인 SQLite 데이터베이스를 소유하는 Local E2E를 구축한다. E2E는 실제 Symphony가 정해진 동작을 수행하는 통제된 Worker를 실행하도록 구성하며, CLI·로그·저장 데이터로 결과를 확인할 수 있어야 한다.

이번 단계는 Local 실행 경로의 연결과 검증을 완료하는 것이 목적이다. Operator UI 전환과 기존 Notion 실행 경로 제거는 포함하지 않는다.

## Intent

앞선 Local Task Store Foundation은 현재 작업 수행에 필요한 데이터를 Notion 없이 저장하고 조회할 수 있는 기반을 구축했다. 그러나 실제 Publisher, Symphony 및 Worker의 작업 데이터 접근은 여전히 Notion 실행 경로에 연결되어 있다.

기존 Notion 기반 운영을 유지하면서 새로운 Local 실행 경로를 독립적으로 구축하고 검증하려 한다. 두 저장 방식을 영구적으로 지원하려는 것이 아니라, Local 실행 경로와 Operator UI가 준비된 이후 기존 Notion 경로를 제거하기 위한 단계적 전환이다.

기존 E2E는 외부 Notion DB Pool의 예약·복구·충돌 방지, Notion API 및 인증, 샌드박스 경계, chatgpt-shot과 GitHub 연동 등으로 인해 구성과 실행이 복잡하다.

Local Task Store에서는 각 E2E 실행이 자신의 데이터베이스를 직접 소유할 수 있으므로, 외부 작업 데이터베이스를 공유하고 관리할 필요가 없다. 새로운 E2E는 이 특성을 활용하여 독립적이고 단순하게 구성한다.

이번 Local E2E의 목적은 실제 AI Worker가 개발 작업을 완수하거나 `WORKFLOW.md`의 전체 개발·리뷰·병합 정책을 검증하는 것이 아니다.

핵심은 다음 작업 데이터 흐름이 실제 실행 구성 요소 사이에서 정상적으로 성립하는지 확인하는 것이다.

1. Accepted Plan 발행
2. Symphony의 Task 발견 및 접수
3. 작업 상태와 의존성에 따른 실행 가능 여부 판단
4. Worker 작업 도구를 통한 데이터 조회 및 상태·기록 변경
5. 저장된 결과의 재조회

E2E에서는 실제 AI Worker 대신 정해진 동작을 수행하는 통제된 Worker를 사용한다. 통제된 Worker는 실제 Symphony의 Worker 실행 경계를 통해 시작된다.

이를 통해 실행 구성 요소 사이의 연결과 작업 데이터 접근 계약을 검증하되, LLM의 비결정적 작업 수행 및 외부 개발 서비스의 결과에 의존하지 않는다.

Local Task Store 자체의 데이터 일관성과 영속성은 앞선 계획에서 검증한 계약을 사용한다. 이번 검증은 저장소 내부 동작을 반복하는 것이 아니라 실제 실행 경로와 저장소 사이의 연결을 확인하는 데 집중한다.

KISS, YAGNI, DRY를 우선하며, 아직 필요하지 않은 범용 Tracker 프레임워크나 복잡한 테스트 자원 관리 체계를 도입하지 않는다.

## Verification Requirements

### VR-1. 독립적인 Local 실행 경로

하나의 Loop 인스턴스에서 Local 실행 경로를 선택하면 Publisher, Symphony Adapter 및 Worker 작업 도구가 동일한 Local Task Store를 사용해야 한다.

Notion API나 Notion 데이터베이스 없이 Task 발행, 조회 및 필요한 상태·기록 변경이 가능해야 한다.

한 Loop 인스턴스의 실행 과정에서 Local과 Notion 작업 데이터가 의도치 않게 혼재되어서는 안 된다.

Local 실행 경로는 기존 Notion 실행 경로와 독립적으로 동작해야 한다.

### VR-2. Accepted Plan 발행

Local 실행 경로를 통해 Accepted Plan을 발행할 수 있어야 한다.

발행된 Task는 Local Task Store에 완전한 상태로 생성되어야 하며, Accepted Plan 원문과 작업 속성을 다시 조회할 수 있어야 한다.

기존 Publisher가 담당하는 Plan 유효성 검증, 중복 발행 방지 및 발행 실패 시 일관성의 의미가 Local 발행 경로에서도 유지되어야 한다.

발행을 위해 대상 Git 저장소에 Plan 파일을 생성하거나 커밋할 필요가 없어야 한다.

### VR-3. Symphony의 Task 접수

실제 Symphony 실행 계층이 Local Task Store에서 Task를 발견하고 기존 작업 상태 및 Blocked By 의미에 따라 실행 가능 여부를 판단할 수 있어야 한다.

실행 가능한 Task는 Worker 실행 대상으로 접수되어야 한다.

실행 불가능한 상태의 Task나 완료되지 않은 선행 Task에 의해 차단된 Task는 실행 대상으로 접수되어서는 안 된다.

차단 관계가 해소되면 기존 스케줄링 의미에 따라 해당 Task를 다시 실행 대상으로 판단할 수 있어야 한다.

이 과정은 테스트가 Symphony의 접수 판단을 재구현한 결과가 아니라 실제 Symphony 실행 경로의 결과여야 한다.

### VR-4. Worker 작업 데이터 접근

Local 실행 경로에서 Worker에게 필요한 Task 조회 및 변경 도구가 제공되어야 한다.

Worker는 해당 도구를 통해 현재 작업 수행에 필요한 다음 데이터를 다룰 수 있어야 한다.

- Task의 기본 속성과 현재 State
- Accepted Plan 원문
- Workpad
- 사용자 Comment
- Blocked By 관계
- 작업 수행에 필요한 속성 및 상태 변경

Worker 작업 도구는 Local Task Store의 데이터 일관성, Accepted Plan 불변성 및 기록 누적 의미를 유지해야 한다.

상태 변경은 실제 실행 경로에서 해당 변경을 담당하는 구성 요소를 통해 수행되어야 한다.

Worker 도구는 Worker에게 허용된 데이터 접근과 변경을 담당하며, Symphony의 상태 관리 및 스케줄링 책임을 대신해서는 안 된다.

### VR-5. 실제 Symphony와 통제된 Worker를 통한 Local E2E

Local E2E는 실제 발행 진입점과 Symphony 실행 경로를 사용해야 한다.

실제 Symphony가 실행 가능한 Task를 접수한 뒤 자신의 Worker 실행 경계를 통해 통제된 Worker를 시작해야 한다.

E2E Harness가 Symphony의 접수 및 Worker 실행 경계를 우회하여 통제된 Worker를 직접 실행한 결과만으로 E2E가 통과해서는 안 된다.

통제된 Worker는 실제 AI 모델을 실행하지 않고 정해진 순서대로 Local Worker 도구를 호출한다.

E2E는 다음 흐름을 검증할 수 있어야 한다.

1. Accepted Plan 발행
2. Symphony의 Task 발견 및 접수
3. Symphony에 의한 통제된 Worker 실행
4. 통제된 Worker의 Task 및 Accepted Plan 조회
5. 실제 책임 경계에 따른 상태·기록 변경
6. Local Task Store의 최종 결과 재조회

실제 LLM 실행, chatgpt-shot 리뷰, GitHub PR 및 병합은 E2E 성공의 필수 조건이 아니어야 한다.

이 E2E의 통과는 전체 `WORKFLOW.md` 정책이나 AI Worker의 개발 수행 성공을 의미하지 않는다.

### VR-6. 실행별 독립성과 반복 가능성

Local E2E는 기존 Notion E2E Harness와 Notion DB Pool에 의존하지 않아야 한다.

각 E2E 실행은 독립적인 상태 디렉터리, SQLite 데이터베이스 및 필요한 실행 자원을 소유해야 한다.

여러 E2E를 연속 또는 병렬 실행하더라도 서로의 Task, 기록, 실행 상태가 혼재되지 않아야 한다.

기존 Notion DB Pool의 예약, 가용성 확인, 복구 및 반환 과정이 필요하지 않아야 한다.

E2E 실행이 성공하거나 실패하더라도 다른 E2E 실행이나 일반 Loop 인스턴스의 자원을 변경·삭제해서는 안 된다.

### VR-7. 실행 결과의 관측과 진단

Local E2E는 명령행에서 실행하고 결과를 확인할 수 있어야 한다.

Task 발행, Symphony 접수, Worker 실행, 작업 도구 호출 및 상태·기록 변경에서 발생한 실패를 구분할 수 있어야 한다.

실제 Local Task Store의 최종 데이터가 기대한 Task ID, State 및 기록과 일치해야 성공으로 판단할 수 있다.

실패 시에는 원인 분석에 필요한 실행 식별자, 실패 단계 및 관련 로그를 확인할 수 있어야 한다.

별도의 사용자용 Task 관리 CLI는 필요하지 않다.

### VR-8. 기존 Notion 실행 경로 보존

이번 변경 이후에도 기존 Notion 기반 Loop 인스턴스의 외부 관측 가능한 동작과 계약이 유지되어야 한다.

기존 Notion Publisher, Tracker Adapter, Worker 도구, Operator UI 및 E2E 실행 경로는 계속 사용할 수 있어야 한다.

현재 `WORKFLOW.md`의 개발·리뷰·병합 정책은 변경되지 않아야 한다.

이번 단계에서 기존 Notion 데이터를 이전하거나 Local Task Store와 동기화할 필요는 없다.

Local 실행 경로를 추가하기 위해 기존 Notion 경로를 제거하거나 기존 E2E를 새로운 E2E로 대체해서는 안 된다.

## Definitions

- **Local Task Store**: Loop 인스턴스가 소유하는 SQLite 기반 작업 저장소.
- **Local 실행 경로**: Publisher, Symphony Adapter 및 Worker 작업 도구가 Local Task Store를 작업 데이터의 권위 저장소로 사용하는 실행 경로.
- **Notion 실행 경로**: 현재 Notion 데이터베이스를 사용하는 기존 작업 실행 경로.
- **실행 경로 선택**: Loop 인스턴스가 사용할 작업 데이터 저장소와 연결 경로를 결정하는 것.
- **Task 접수**: Symphony가 실행 가능한 Task를 발견하고 Worker 실행 대상으로 전달하는 것. 개발 작업의 완료를 의미하지 않는다.
- **Worker 실행 경계**: Symphony가 실행 대상으로 선택한 Task에 대해 Worker 실행을 시작하고 관리하는 경계.
- **Local Worker 도구**: Worker가 Local Task Store의 작업 데이터를 조회하고 변경하기 위해 사용하는 인터페이스.
- **통제된 Worker**: 실제 AI 모델을 실행하지 않고 정해진 순서대로 Worker 작업 도구를 호출하는 E2E 참여자.
- **Local E2E**: 실제 발행·Symphony 실행 경로와 통제된 Worker를 연결하여 작업 데이터 흐름을 검증하는 독립적인 테스트 환경.
- **E2E 실행 인스턴스**: 하나의 Local E2E 실행이 소유하는 격리된 런타임, 데이터베이스 및 관련 자원의 집합.

## Decisions

### 1. 기존 경로와 새로운 경로의 일시적 공존

기존 Notion 실행 경로를 유지하면서 별도의 Local 실행 경로를 추가한다.

새 Local Adapter와 Worker 작업 도구를 추가하며 기존 Notion 실행 계약은 유지한다.

Loop 인스턴스 수준에서 사용할 실행 경로를 선택한다. Publisher, Symphony 및 Worker는 해당 선택을 일관되게 따라야 한다.

이 선택 구조는 단계적 전환을 위한 임시 경계다. 여러 Tracker를 영구적으로 지원하는 범용 프레임워크를 구축하지 않는다.

구체적인 설정 방식과 시작 경로 연결은 기존 프로젝트 설정 및 런타임 구조를 기준으로 결정한다.

### 2. Local Task Store의 기존 계약 사용

앞선 Local Task Store Foundation에서 완성한 데이터 모델과 저장 인터페이스를 사용한다.

Local Adapter와 Worker 도구는 저장소의 데이터 일관성 책임을 중복 구현하지 않는다.

Task 상태와 실행 가능 여부에 대한 정책적 판단은 기존 Symphony 실행 계층의 책임으로 유지한다.

Accepted Plan은 Local Task Store에 귀속된 불변 실행 입력으로 사용한다.

Worker가 관리하는 Git Plan 문서는 별도의 개발 산출물이며, 이번 계획에서 생성·관리·동기화하지 않는다.

### 3. 통제된 Worker의 역할

통제된 Worker는 실제 Symphony의 Worker 실행 경계를 통해 시작한다.

AI 모델이나 실제 개발 작업을 수행하지 않고, 미리 정해진 Task 조회 및 기록 변경을 수행한다.

통제된 Worker는 생산 환경의 Local Worker 도구를 사용한다. 테스트 전용 저장소 조작으로 해당 도구를 우회하지 않는다.

상태 변경은 기존 실행 경로의 책임에 따라 처리한다. 통제된 Worker는 Worker에게 허용된 상태 변경만 수행한다.

통제된 Worker의 구현은 테스트 범위에 필요한 동작으로 제한하며, 실제 AI Worker의 작업 수행 절차를 재현하지 않는다.

### 4. E2E 검증 범위

Local E2E는 작업 데이터의 실제 연결과 실행 접수를 검증한다.

실제 Publisher, Symphony 및 Worker 실행 경계를 사용한다.

핵심 종단 시나리오는 발행, 접수, 통제된 Worker 실행, 데이터 접근, 상태·기록 반영 및 최종 재조회로 제한한다.

저장소 자체의 중복 발행 방지, 원자성, 불변성, 동시 쓰기 및 영속성은 기존 Local Task Store 테스트를 활용한다.

Adapter의 개별 동작, Blocked By 판단 및 오류 전달처럼 좁은 검증으로 충분히 입증 가능한 사항은 단위·통합 테스트로 확인할 수 있다.

E2E는 실제 AI Worker의 개발 능력이나 전체 `WORKFLOW.md` 정책의 성공을 검증하지 않는다.

### 5. Local E2E의 독립적 구성

기존 `e2e/`와 별도로 Local E2E를 구축한다.

새 E2E는 기존 Notion DB Pool과 실행 예약·복구 체계에 의존하지 않는다.

각 실행은 자신의 SQLite 데이터베이스와 필요한 실행 자원을 직접 소유한다.

별도의 데이터베이스 서버, 공유 데이터베이스 풀, 예약 시스템 또는 분산 잠금을 도입하지 않는다.

기존 E2E의 실행·관측 기능 중 새로운 E2E에서도 의미가 유지되는 부분은 재사용할 수 있다. 다만 재사용을 위해 기존 E2E의 구조를 대규모로 변경하지 않는다.

실제 파일 및 디렉터리 구성은 기존 저장소 관례에 맞춰 결정한다.

### 6. 명령행 실행과 로그

Local E2E는 명령행에서 실행할 수 있도록 한다.

E2E 실행 결과를 확인하기 위한 별도의 사용자용 Task 관리 CLI를 구축하지 않는다.

기존 명령이나 테스트 도구로 충족할 수 있는 기능은 중복 구현하지 않는다.

로그는 실행 식별, Task 발행·접수, Worker 실행, 데이터 변경 및 실패 지점을 확인할 수 있는 수준으로 유지한다.

별도의 복잡한 관측 시스템이나 로그 관리 UI는 도입하지 않는다.

### 7. E2E 실행 자원의 생명주기

E2E 실행마다 자신이 생성한 자원을 식별하고 관리한다.

정상 완료 후 임시 실행 자원을 정리할 수 있도록 하며, 실패 시에는 원인 분석에 필요한 로그 및 실행 요약을 남긴다.

다른 E2E 실행 또는 일반 Loop 인스턴스의 자원을 정리 대상으로 삼지 않는다.

기존 E2E의 Notion DB 회수 및 복구 절차는 새로운 Local E2E에 도입하지 않는다.

### 8. 보호 범위와 명명

다음 기존 동작과 계약은 유지한다.

- 기존 Notion Publisher의 발행 의미와 결과
- 기존 Notion Tracker Adapter의 동작
- 기존 `notion_task_*` Worker 도구의 계약
- 기존 Notion E2E Harness의 실행 동작
- Operator UI의 사용자 흐름
- `WORKFLOW.md`의 개발·리뷰·병합 정책
- Symphony의 기존 작업 생명주기 및 스케줄링 정책
- GitHub PR 및 병합 계약
- chatgpt-shot 실행 계약
- 기존 Notion 데이터의 생명주기

Local 실행 경로 추가를 위해 공유 설정·시작·실행 경계의 내부 구조를 변경할 수 있다. 다만 기존 Notion 경로의 외부 관측 가능한 의미와 결과가 달라져서는 안 된다.

새 파일·모듈·타입·주요 함수의 이름은 현재 맡는 구체적인 책임을 드러내야 한다.

아직 필요하지 않은 범용 Tracker 프레임워크나 영구적인 다중 저장소 지원을 전제로 이름을 설계하지 않는다.

### 9. 구현 범위에서 제외할 기능

이번 단계에서는 다음을 구현하지 않는다.

- Operator UI의 Local Task Store 전환
- 기존 Notion 실행 경로 제거
- 기존 Notion E2E 제거
- Notion 데이터 마이그레이션
- Notion과 Local Task Store 사이의 동기화
- 실제 AI Worker를 이용한 E2E
- 전체 `WORKFLOW.md` 개발·리뷰·병합 E2E
- 실제 GitHub PR 생성 및 병합 검증
- chatgpt-shot 리뷰 실행 검증
- 범용 Tracker 플러그인 프레임워크
- 별도의 데이터베이스 서버
- 범용 작업 관리 CLI
- 새로운 실행 로그 관리 UI
- Symphony 스케줄링 정책 재설계

## Planned Units

### 1. Local 작업 데이터 접근

Local Publisher, Symphony Tracker Adapter 및 Local Worker 도구를 Local Task Store에 연결한다.

Loop 인스턴스가 기존 Notion 실행 경로와 Local 실행 경로를 구분하여 선택할 수 있도록 한다.

**독립적인 결과:** Notion 없이 Accepted Plan을 발행하고 Publisher, Symphony Adapter 및 Worker 도구에서 동일한 Local Task 데이터를 조회·변경할 수 있다.

### 2. Local Task 실행 연결

실제 Symphony가 Local Task Store에서 실행 가능한 Task를 발견하고 Worker 실행 대상으로 접수하도록 한다.

Symphony의 기존 실행 가능 여부 판단과 Worker 실행 경계를 유지하면서 통제된 Worker를 실행할 수 있도록 연결한다.

**독립적인 결과:** 실제 Symphony가 Local Task를 접수하고 통제된 Worker를 시작하며, Worker가 Local 작업 데이터에 접근할 수 있다.

### 3. 독립적인 Local E2E

실행마다 독립적인 Loop 상태 및 SQLite 데이터베이스를 소유하는 Local E2E를 구축한다.

실제 Publisher와 Symphony 실행 경로를 사용하고, Worker 단계에서는 정해진 작업 도구 호출을 수행하는 통제된 Worker를 사용한다.

발행, 접수, Worker 실행, 데이터 조회, 상태·기록 변경 및 저장 결과 확인을 하나의 실행에서 검증한다.

명령행 출력과 로그를 통해 실행 결과 및 실패 지점을 관측할 수 있도록 한다.

**독립적인 결과:** 기존 Notion E2E나 외부 개발·리뷰 서비스 없이 Local 작업 실행 경로의 핵심 데이터 흐름을 반복적으로 검증할 수 있다.

## Verification

### VR-1. 독립적인 Local 실행 경로

Local 실행 경로를 선택한 격리 Loop 인스턴스에서 Task 발행, 조회 및 변경을 수행한다.

Publisher, Symphony Adapter 및 Worker 도구가 동일한 Task ID와 저장 데이터를 사용하는지 확인한다.

Notion 인증 및 데이터베이스 설정 없이 Local 경로가 정상 동작해야 한다.

별도의 Notion 경로 인스턴스와 데이터가 혼재되지 않는지 확인한다.

### VR-2. Accepted Plan 발행

실제 Local 발행 진입점으로 Accepted Plan을 제출한다.

생성된 Task ID, Identifier, 기본 속성 및 Accepted Plan 원문을 Local Task Store에서 재조회한다.

기존 Local Task Store의 중복 발행·실패 일관성 테스트를 활용하고, Publisher 연결 경계에서 해당 계약이 유지되는지 확인한다.

대상 Git 저장소에 Plan 파일이 없는 조건에서도 발행이 가능한지 확인한다.

### VR-3. Symphony의 Task 접수

실제 Symphony 프로세스를 실행하고 Local Task Store에 실행 가능한 Task를 발행한다.

Symphony가 해당 Task를 발견하고 Worker 실행 대상으로 접수하는지 확인한다.

실행 가능 여부에 대한 대표 조건을 검증한다.

- 실행 가능한 State
- 실행 불가능한 State
- 완료되지 않은 선행 Task에 의한 차단
- 선행 Task 완료에 따른 차단 해소

실제 Symphony의 접수 이벤트를 확인한다.

상태·차단 조건에 대한 세부 판단은 기존 Symphony 테스트 및 Local Adapter 통합 테스트를 활용할 수 있다.

### VR-4. Worker 작업 데이터 접근

Local Worker 도구를 통해 Task와 Accepted Plan을 조회한다.

Workpad와 Comment를 추가하고 Worker에게 허용된 작업 데이터 변경을 수행한다.

변경 결과를 실제 Local Task Store에서 재조회한다.

상태 변경은 해당 변경의 실제 책임 주체를 통해 수행하고, 최종 State가 저장소에 반영되었는지 확인한다.

Accepted Plan 불변성과 기록 누적 의미는 기존 저장소 테스트를 활용하되, Local Worker 도구가 해당 계약을 올바르게 사용하는지 확인한다.

### VR-5. 실제 Symphony와 통제된 Worker를 통한 Local E2E

Local E2E에서 다음 시나리오를 실행한다.

1. 실제 Publisher로 Accepted Plan 발행
2. 실제 Symphony의 Task 발견 및 접수
3. Symphony의 Worker 실행 경계를 통한 통제된 Worker 시작
4. 통제된 Worker의 Task 및 Accepted Plan 조회
5. 통제된 Worker의 Workpad 추가
6. 실제 책임 경계에 따른 State 변경
7. SQLite 재조회 및 기대 결과 비교

Symphony가 통제된 Worker를 실제로 시작했다는 증거를 확인한다.

통제된 Worker가 생산 환경의 Local Worker 도구를 호출했다는 증거를 확인한다.

발행된 Task ID와 Worker가 읽고 변경한 Task ID가 동일해야 한다.

실제 저장 데이터가 기대한 State 및 Workpad 기록을 포함해야 통과한다.

실제 AI Worker, chatgpt-shot 또는 GitHub 연동 없이 전체 시나리오가 완료되어야 한다.

### VR-6. 실행별 독립성과 반복 가능성

Local E2E를 연속으로 반복 실행한다.

두 개 이상의 Local E2E를 동시에 실행하고 각각의 Task 및 기록이 서로 다른 SQLite 데이터베이스에 저장되는지 확인한다.

기존 Notion DB Pool 설정 없이 E2E를 실행한다.

성공·실패 시 각 실행이 소유한 프로세스, 포트 및 임시 자원을 확인한다.

한 실행의 종료 및 정리가 다른 실행이나 일반 Loop 인스턴스에 영향을 주지 않아야 한다.

### VR-7. 실행 결과의 관측과 진단

정상 E2E 실행의 명령행 출력과 로그에서 다음을 확인한다.

- 실행 식별자
- 발행된 Task ID
- Symphony의 Task 접수
- 통제된 Worker의 시작
- Worker 작업 도구 호출 결과
- 최종 Task State
- 저장된 Workpad 기록
- 최종 성공·실패 결과

대표적인 발행·접수·Worker 도구 실패를 발생시키고, 각 실패가 어느 경계에서 발생했는지 확인한다.

출력과 로그의 성공 표시만으로 통과시키지 않고 실제 SQLite 데이터의 최종 결과를 대조한다.

### VR-8. 기존 Notion 실행 경로 보존

기존 Notion Publisher, Adapter, Worker 도구 및 Operator 관련 회귀 테스트를 수행한다.

기존 E2E 진입점과 설정 계약이 유지되는지 확인한다.

실제 Notion E2E를 실행할 수 있는 환경에서는 기존 경로의 대표 실행을 검증한다.

외부 환경을 사용할 수 없다면 관련 통합 테스트와 정적 검사를 수행하고, 실제 Notion 종단 실행까지 검증하지 못했다는 한계를 명시한다.

Git Diff를 통해 기존 Notion 실행 계약과 `WORKFLOW.md` 정책의 보호 범위가 유지되는지 확인한다.

## Verification Tools

- **Node.js 테스트 러너:** Local Publisher, Worker 도구 및 Local Task Store 연결 계약 검증
- **실제 SQLite 파일:** 발행된 Task, 상태·기록 변경 및 권위 있는 최종 결과 재조회
- **Symphony Elixir 테스트:** Local Tracker Adapter 및 상태·의존성 판단 계약 검증
- **실제 Symphony 프로세스:** Task 발견·접수 및 통제된 Worker 실행 확인
- **통제된 Worker:** 실제 Local Worker 도구를 통한 결정적 데이터 조회·변경 검증
- **Local E2E Harness:** 발행부터 접수·Worker 실행·기록 변경·재조회까지의 통합 실행과 격리 검증
- **명령행 출력 및 실행 로그:** 실행 단계, Task ID, 상태 변화 및 실패 경계 관측
- **기존 회귀 테스트:** Notion 실행 경로의 호환성 확인
- **Git Diff 및 정적 검사:** 기존 실행 계약과 보호된 정책의 불필요한 변경 확인
