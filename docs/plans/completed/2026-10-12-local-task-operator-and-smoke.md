# 2026-10-12-local-task-operator-and-smoke

## Objective

leesh-loop의 작업 운영 체계를 Notion Task 시스템에서 Local Task Store 기반으로 완전히 전환한다.

사용자가 Operator UI에서 Accepted Plan을 발행하고, 작업 진행 상황을 확인하며, Human Review 입력과 State 및 Blocked By 변경을 수행할 수 있도록 한다. Symphony와 Worker는 동일한 Local Task Store를 사용한다.

Local 운영 체계로 전환하면서 대체되는 Notion Task 구현을 제거하고, 전환이 완료된 후 남은 Notion Task 의존성을 정리하여 leesh-loop의 작업 운영 경로가 Notion 없이 작동하도록 한다.

실제 Operator UI와 Local 실행 경로를 독립적으로 구동·조작·검증할 수 있는 내부 Smoke Run을 제공한다.

## Intent

기존 Local Task Store Foundation과 Local Execution Integration으로 SQLite 작업 저장소, Local Publisher, Symphony Adapter, Worker 도구가 구현되었다. 그러나 현재 Operator UI는 Notion에 연결되어 있고 Local 모드에서는 실행되지 않아 사용자가 Local 작업을 일상적으로 운영할 수 없다.

사용자는 ChatGPT 등에서 확정한 Accepted Plan을 Operator에 붙여넣어 최초 작업을 발행하고, 이후 작업 상태를 확인하거나 Human Review에 의견을 남기고 다음 State를 선택하는 방식으로 leesh-loop를 사용하려 한다. Notion 작업을 이전하거나 Git Plan을 자동으로 수집할 필요는 없다.

Local Task 시스템이 기존 Notion Task 시스템을 대체하는 것이므로 두 작업 운영 경로를 영구적으로 유지할 필요가 없다. Local 운영 기능을 완성하는 과정에서 기존 Notion 구현을 자연스럽게 제거하고, 마지막에 남은 의존성을 정리한다.

다만 chatgpt-shot은 기존처럼 외부 실행 서비스로 취급한다. chatgpt-shot이 내부적으로 Notion을 사용하는 것은 leesh-loop의 Task 시스템과 별개의 책임이다. 이 계획은 chatgpt-shot의 구현이나 외부 서비스 운영 방식을 변경하려는 작업이 아니다.

Operator UI는 기존 디자인 구현을 공유할 필요가 없다. 기존 `docs/DESIGN.md`의 디자인 철학을 유지하면서 Local 작업 운영에 맞는 새로운 화면을 구성한다.

UI 평가와 개발 과정에서 실제 사용자 Loop나 실제 AI Worker에 의존하지 않도록, 격리된 Local 데이터와 통제된 Worker를 사용하면서 실제 웹 화면을 열고 조작할 수 있는 Smoke Run이 필요하다. 이는 이번 UI 검증뿐 아니라 이후 UI 개선에도 사용할 개발 도구다.

기존 Notion 기반 Loop의 실행 호환성이나 자동 전환은 이번 작업의 목적이 아니다. 사용자는 Local 운영에 필요한 Runtime과 Workflow를 각각 업데이트한다고 가정한다.

## Verification Requirements

### VR-1. Local 기반 작업 운영

새로 초기화한 Loop는 Local Task Store를 작업 데이터의 권위 저장소로 사용한다. 일반적인 Loop 시작·종료·재시작 과정에서 Operator UI와 Symphony가 해당 Loop의 동일한 Local Task Store에 연결된다. 발행, 조회, State 및 Blocked By 변경, Worker 실행 대상 판단과 도구 호출은 Notion Task DB·인증·Publisher·API에 의존하지 않는다. chatgpt-shot의 외부 준비 및 내부 의존성은 이 조건의 대상이 아니다. Loop 소유 데이터는 정상 종료·재시작 및 지원되는 Local Runtime 업데이트 후에도 보존된다. 과거 Notion Loop 업데이트 호환성은 요구하지 않는다.

### VR-2. Accepted Plan 발행

빈 Store에서도 Operator에 Accepted Plan 원문을 입력해 첫 Task를 발행하고 State와 Blocked By를 선택할 수 있다. 별도 Git Plan이나 Notion 페이지는 필요하지 않다. 기존 Local Publisher가 Title·Identifier, 원자적 Task/불변 Plan 발행, 기본 속성, 실패 및 멱등성 처리를 소유한다. 성공 응답은 식별 정보와 저장 결과를 확인하고 상세를 열 수 있으며, 실패·불확실 응답을 성공으로 표시하지 않는다. 반복·재시도·동시 요청은 기존 Publisher 계약을 따른다. 독립 신규 발행에 별도 중복 정책을 추가하지 않는다. Publisher의 H1 기반 Title과 Workflow의 `date-summary` Repository Plan 경로는 별도 책임이다.

### VR-3. 작업 목록과 상세 조회

목록은 Title, State, Blocked By의 Title/State, Priority, Labels, Identifier를 표시하고 Human Review를 먼저 발견할 수 있도록 하며 Merging·In Progress와 나머지 작업의 중요도를 드러낸다. 상세는 Accepted Plan 원문, Workpad, 댓글, Blocked By와 현재 속성을 제공한다. Notion 링크나 Symphony Dashboard가 필요하지 않다. 조회 실패는 보이고 기존 정상 결과를 실패한 새 조회 결과처럼 표시하지 않는다.

### VR-4. 사용자 작업 관리와 Human Review

사용자는 Task State와 Blocked By를 변경하고 댓글을 작성한다. Human Review에서는 기존 내용과 Workpad를 읽고 댓글 작성 후 Workflow 의미에 따라 다음 State를 선택한다. 댓글은 식별 정보와 순서를 보존해 Worker가 후속 입력으로 읽을 수 있다. State 전이 정책은 Workflow 소유다. Blocked By는 Local Task ID로 저장되고 존재하지 않는 Task 또는 자기 자신은 대상이 될 수 없다. Accepted Plan은 불변, Workpad는 읽기 전용이다. Title·Priority·Labels 편집, 새로운 충돌 해결·우선권·복구 정책은 추가하지 않는다.

### VR-5. Operator와 Symphony·Worker의 데이터 연속성

Operator가 Local Publisher로 만든 Task는 Symphony Local 경로에서 처리된다. Worker의 State와 Workpad 변경은 Operator에서 확인되고, Operator의 댓글·State·Blocked By 변경은 Worker Local Task 도구와 Symphony 실행 대상 판단에 반영된다. Blocked By 완료 후 재개와 Human Review 후 사용자가 선택한 State로 이어지는 기존 Workflow 의미를 보존한다. 주기 갱신은 Plan·댓글·State·Blocked By 초안을 덮어쓰지 않고 저장 결과는 실제 결과와 일치한다.

### VR-6. Operator UI의 디자인과 실사용 흐름

`docs/DESIGN.md` 철학을 따르는 Local UI를 새로 설계한다. 흰색·검정·회색만 사용하며 유채색 강조, 상태 색상표, 그라데이션, 장식적인 상자·테두리·좌측 레일을 쓰지 않는다. 타이포그래피·여백·정렬·배치와 최소 경계로 위계를 만든다. 넓은 화면에서 프로젝트·목록·상세/발행을 함께 사용할 수 있고 좁은 화면에서도 같은 정보와 행동에 접근할 수 있다. 첫 Plan 발행, Human Review 발견, Plan·Workpad 확인, 댓글, State, Blocked By, 새 Plan 발행 흐름이 명확하다. 프로젝트명·GitHub 저장소 링크, 무채색의 선택/진행/성공/실패 표시, 키보드 주요 동작을 제공한다.

### VR-7. Notion Task 시스템의 완전 제거

Local 운영으로 대체되는 Notion Task Publisher, Reader, Operator 연결, Symphony Adapter 및 Worker 도구, Task 전용 설정·초기화·실행·업데이트·테스트·문서를 제거한다. Local 대응 경로를 완성하는 과정에서 교체하고, 완료 후 잔여 참조를 정리한다. 새 Loop 초기화·실행·Operator·Symphony·Worker 및 관련 테스트는 Notion Task를 요구하거나 선택하지 않는다. 외부 Notion 데이터나 페이지를 변경하지 않으며 사용자 Loop의 설정·Workflow·SQLite 데이터를 덮어쓰지 않는다. 과거 Notion Loop 호환성·자동 전환·마이그레이션·Runtime/Workflow 버전 불일치는 범위 밖이다. chatgpt-shot의 외부 계약과 내부 Notion 사용은 유지한다.

### VR-8. Workflow의 Local 전환

새 Loop Workflow는 Local Task ID와 `local_task_*` 도구로 Accepted Plan·Workpad·댓글 조회, State 변경, 후속 Plan 발행, Blocked By 변경을 수행한다. Notion Task 페이지·관계·도구·인증 지침은 남기지 않는다. State 의미, Human Review·Review Input·Rework·Blocked By 대기/재개, Repository Plan, 리뷰·PR·Merging·Done 정책을 보존한다. Runtime과 Workflow의 독립 업데이트를 유지하며 Runtime 업데이트는 사용자 수정 Workflow를 덮어쓰지 않는다. 과거 Notion Workflow 변환·호환성은 제공하지 않는다.

### VR-9. 내부 Smoke Run

실제 사용자 Loop와 분리된 Local Store·Publisher·Operator 웹·Symphony·통제된 Worker를 실행한다. 실제 AI Worker나 외부 Notion DB 없이 자동 검증과 대화형 평가를 제공한다. 두 모드는 구성과 실제 구성 요소를 공유하지만 시나리오와 종료 조건은 분리한다. 자동 모드는 실제 경계에서 발행·조회·변경·Worker 도구 호출 및 저장 결과를 검증하고 끝난다. 대화형 모드는 실제 Publisher가 발행한 서로 다른 Backlog Task 3개를 준비하고 초기 상태를 유지해 브라우저에서 조작·평가하게 한다. 필요한 Workpad·댓글·Blocked By·Human Review 상태는 Store 계약과 통제된 Worker 도구로 만든다. 일반 Loop에는 샘플을 넣지 않으며 정상 종료 시 Smoke 소유 프로세스와 임시 데이터를 정리할 수 있다. 프런트엔드 목업은 사용하지 않는다.

### VR-10. UI 평가 증거

실행 중인 Local Operator를 실제 브라우저의 넓은 화면과 좁은 화면에서 평가하고 다음 실제 화면을 캡처한다: Backlog 3개 목록, 빈 Store의 Plan 발행, Accepted Plan·Workpad·댓글 상세, Human Review 댓글 및 State 조작, 좁은 화면의 목록·상세. 이미지는 `docs/ui-evidence/`에 저장되어 PR에 포함되고 chatgpt-shot UI/UX 리뷰에서 열람 가능해야 한다. 화면은 시각적 증거이며 기능 성공은 실제 요청과 권위 Store 결과로 별도 입증한다.

## Definitions

- **Local Task Store:** Loop별 SQLite 기반 Task 데이터의 권위 저장소.
- **Task:** Accepted Plan과 현재 속성, Blocked By, Workpad, 댓글을 가진 작업 단위.
- **Accepted Plan:** 발행 시 Task에 귀속되는 불변 Plan 원문.
- **Repository Plan:** Worker가 Git 저장소에서 관리하는 `docs/plans/active/<date-summary>.md` 문서.
- **Local Publisher:** Accepted Plan을 Local Task Store의 Task로 발행하는 기존 구성 요소.
- **Operator:** 사용자가 Task를 발행·조회·관리하는 Loop 소유 웹 인터페이스와 서버.
- **Workflow:** State 전환의 의미와 Worker의 개발·리뷰·병합 행동을 규정하는 실행 계약.
- **Workpad:** Worker가 추가하는 Task 실행 기록.
- **Comment:** 사용자가 추가하는 입력 기록으로 Human Review 후속 입력 판정에 사용한다.
- **Blocked By:** 다른 Task 완료까지 현재 Task 실행을 대기시키는 관계.
- **내부 Smoke Run:** 격리된 Local 환경에서 자동 검증 또는 대화형 UI 평가를 수행하는 개발 도구.
- **통제된 Worker:** 실제 AI 모델 대신 미리 정한 Local Task 도구 호출을 실행하는 테스트 Worker.
- **Notion Task 시스템:** 기존 leesh-loop의 작업 발행·저장·조회·상태 변경용 Notion 구현. chatgpt-shot 내부 Notion 사용은 제외한다.

## Decisions

1. **Local Store가 유일한 저장소다.** 완료된 Local Task Store Foundation과 Local Execution Integration의 계약을 재사용한다. 새 저장소, 범용 Tracker 추상화, 동기화 계층을 만들지 않는다. `task_store` 선택을 Local 단일 운영에 맞게 정리하고 새 Loop 기본값/Workflow를 Local로 한다. Operator는 Publisher 공개 경계를 사용하고 SQLite에 직접 쓰거나 정책을 복제하지 않는다.
2. **발행·State 책임을 유지한다.** Local Publisher가 Plan 발행, Title·Identifier, 기본 속성, 원자성 및 중복 처리를 담당한다. Operator의 State 선택은 기존 Workflow State 집합을 사용하되 Store/Publisher에 전이 제한을 추가하지 않는다. H1 `date-summary`는 Repository Plan 경로 전용이다. 동시 수정에 새 충돌 정책을 만들지 않는다.
3. **화면 구성.** 상단에 프로젝트명과 GitHub 링크, 왼쪽에 Human Review 우선/진행 중/Other tasks 목록, 오른쪽에 Publish 또는 선택 상세. 목록은 Title·State 우선, Blocked By·Priority·Labels·Identifier 보조. 낮은 우선순위 상태도 필요 시 접근 가능. 상세는 현재 State와 행동, Plan·Workpad·댓글·사용자 입력을 제공한다. Human Review에서 댓글과 다음 State를 같은 문맥에 둔다. 넓은 화면은 병렬, 좁은 화면은 세로 배치.
4. **디자인.** `docs/DESIGN.md`를 따르고 무채색만 사용한다. 유채색 상태 표시, 장식 카드·테두리·좌측 레일을 피하고 타이포그래피·배치로 위계를 만든다.
5. **변경·갱신.** 사용자가 편집하는 것은 State, Blocked By, Comment뿐이다. Accepted Plan·Workpad는 읽기 전용이고 Title·Priority·Labels는 편집하지 않는다. 제출은 명시적이며 저장 응답 후 Store 값을 표시한다. 주기 갱신은 작성 중인 초안을 유지한다. 별도 실시간 동기화나 충돌 복구는 만들지 않는다.
6. **제거 순서.** Local Operator가 완성되면 Notion 연결을 없애고, 발행/실행 기능이 Local로 대체되는 단계마다 대응 Notion 경로를 제거한다. Local 경로 완성 뒤 초기화·실행·업데이트·Worker·테스트·문서의 잔여 의존성을 정리한다. 외부 Notion 데이터는 변경하지 않는다.
7. **기존 Loop 보호.** `WORKFLOW.md`, `project.toml`, `.env`, SQLite는 사용자 소유다. Runtime 업데이트와 명시적 Workflow 업데이트는 독립적으로 유지한다. 과거 Notion 설정의 호환·자동 전환·마이그레이션은 제공하지 않는다.
8. **Smoke Run.** 기존 `local-e2e/`의 격리 구성, 실제 Symphony, 통제된 Worker, 결과 재조회 방식을 확장한다. 자동·대화형 모드는 실제 Store·Publisher·Operator·Symphony를 공유한다. 자동은 사전 정의 시나리오 뒤 종료, 대화형은 실제 Publisher로 Backlog 3개 및 필요한 상태를 준비하고 브라우저 조작을 유지하다 명시 종료 시 정리한다.
9. **보호 범위와 명명.** Local Store 데이터 의미·발행 계약·Symphony 정책·Workflow 개발/리뷰/병합 의미, GitHub PR 처리, 실제 AI Worker와 chatgpt-shot 외부 계약을 보호한다. 원격 Operator, 다중 사용자 권한, 새 서버, 범용 Tracker, 마이그레이션, 범용 로그 UI는 범위 밖이다. chatgpt-shot 내부 Notion 구현·인증·Invocation 저장은 변경하지 않는다. 이름은 현 책임을 드러낸다.
10. **UI 증거.** Smoke Run의 실제 Local Publisher로 Backlog 3개를 만들고 필요한 추가 상태는 Store/통제된 Worker로 만든다. 실제 Operator 브라우저 캡처를 `docs/ui-evidence/`에 저장한다. 민감정보를 넣지 않고 캡처를 기능 검증 대체물로 쓰지 않는다.

## Planned Units

1. **Local Operator 운영:** Loop Operator를 Local Store에 연결해 빈 Store에서 발행하고 작업을 조회·변경한다.
2. **Local 작업 UI와 Human Review:** 무채색 목록·상세·Plan/Workpad/댓글 열람과 State·Blocked By·댓글 입력을 제공한다.
3. **Local Workflow와 실행 연속성:** 새 Loop와 Workflow를 Local로 전환하고 Operator·Symphony·Worker가 같은 Store를 사용한다.
4. **Notion Task 구현 제거:** Local 대응 완료에 맞춰 Notion Task 코드를 제거하고 최종 잔여 의존성을 정리한다.
5. **내부 Smoke Run:** 격리 Local Store, 실제 Operator·Symphony, 통제된 Worker의 자동/대화형 실행을 제공한다.
6. **UI 평가와 PR 증거:** 넓은·좁은 화면의 실제 캡처와 UI 흐름 평가를 PR에 담는다.

## Verification

- 새 Loop를 Local 설정만으로 초기화·시작·종료·재시작하고 Operator와 Symphony의 동일 Store 연결 및 SQLite 데이터 보존을 확인한다. Notion Task 설정/인증 없이 Operator 작업 흐름이 성공해야 한다.
- 빈 Store의 실제 Operator에서 발행하고 반환 Task ID로 Task·불변 Accepted Plan·State·Blocked By를 독립 조회한다. Publisher 계약의 반복/동시/충돌/실패 결과를 확인하고 Title 결정과 Repository Plan 경로를 구분한다.
- 다양한 State·Blocker·Priority·Labels를 가진 Task를 실제 브라우저에서 보고 Human Review 우선순위, 필드, 상세와 조회 실패 처리를 확인한다.
- Operator에서 댓글·State·Blocked By를 제출하고 Store에서 대상·값·댓글 ID/순서·Plan 불변성을 확인한다. 잘못된 Blocked By와 실패를 확인한다.
- Local Publisher → Symphony → 통제된 Worker의 실제 `local_task_*` 호출을 거쳐 State·Workpad·Comment 조회/변경을 확인하고 Operator/SQLite에서 결과를 재조회한다. 역방향 변경 반영, Blocked By 해소, Human Review 흐름을 대표적으로 검증한다. AI/GitHub 병합의 성공으로 과장하지 않는다.
- 실제 브라우저에서 넓은·좁은 화면, 발행/목록/상세/Human Review 흐름, 무채색 위계, 키보드, 저장·실패 표시, 편집 중 갱신을 평가한다.
- 초기화·실행·업데이트·Operator·Publisher·Adapter·Worker·Workflow·테스트·문서의 Notion Task 참조를 조사한다. chatgpt-shot 외부 계약, 사용자 데이터 보호를 확인한다.
- 새 Workflow의 Local 도구·Task ID 기준 동작, 기존 상태 의미, Runtime/Workflow 업데이트 독립성을 확인한다.
- 격리된 Smoke 자동/대화형 모드의 실제 경로와 종료 정리를 확인한다. 대화형은 Backlog 3개의 초기 상태를 확인한다.
- 실제 화면 캡처가 `docs/ui-evidence/`에 있고 PR에 포함됨을 확인한다. UI와 기능 증거를 분리한다.

## Verification Tools

- Node 테스트: Local Task Store, Publisher, Operator 서버, 초기화·업데이트와 실패/재시도.
- Elixir 테스트: Symphony Local Adapter, 실행 대상 판단, Worker Task 도구 연결.
- 내부 Smoke Run 자동 모드: 실제 Operator·Publisher·SQLite·Symphony·통제된 Worker 통합 흐름.
- 내부 Smoke Run 대화형 모드와 브라우저: 실제 UI 상호작용, 넓은·좁은 화면, 캡처.
- SQLite 독립 재조회: Task·Accepted Plan·State·Blocked By·Workpad·Comment 권위 결과.
- 생성 Workflow와 실제 Worker 도구 호출: Local 전환과 Workflow 실행 의미.
- 코드·설정·의존성·문서 조사: Notion Task 경로 잔여 확인.
- Git diff 및 PR 확인: 캡처 포함, 제거 범위, 사용자 데이터 보호, chatgpt-shot 계약.
