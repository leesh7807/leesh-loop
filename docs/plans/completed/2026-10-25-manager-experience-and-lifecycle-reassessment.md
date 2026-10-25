# 2026-10-25-manager-experience-and-lifecycle-reassessment

## Objective

PR #120에서 도입된 중앙 Manager 구조의 사용 경험과 운영 모델을 재평가하고, 발견된 기능적 결함, 불완전한 관리 동작, 불합리한 상호작용 및 시각적 문제를 해결한다.

사용자는 여러 Git 저장소의 Loop를 자연스럽게 등록·관리·해제하고, 작업을 수행하며, 실행 상태와 업데이트의 의미를 혼동하지 않아야 한다.

leesh-loop 자체를 관리 대상으로 사용하는 경우를 포함해 개발·실행·업데이트·복구의 경계가 일관되고 안전해야 한다.

개선 결과는 실제 동작과 사용 경험을 판단할 수 있는 충분한 증거를 통해 검증 가능해야 한다.

## Intent

PR #120은 기존 개별 Operator 구조를 중앙 Manager로 전환했지만, 결과적인 사용 경험에는 납득하기 어려운 부분이 남아 있다.

Runtime 업데이트 버튼의 의미와 배치, Failed/Error 노출 방식, Git 저장소 등록 과정, 등록한 Loop의 관리 해제 부재, 관리 기능의 과도한 화면 집중 등이 대표적인 문제다.

이 문제들은 개별 버튼이나 메시지의 표현만이 아니라 사용자가 실제로 무엇을 관리하며 어떤 순서로 행동하는지를 충분히 고려하지 않은 구조에서 비롯되었을 수 있다.

특히 기존 Operator의 Task 중심 화면에 인스턴스 및 Runtime 관리 기능을 추가한 현재 구성을 올바른 출발점으로 가정하지 않는다.

또한 leesh-loop 개발 저장소와 설치된 Runtime, 중앙 Manager, 개별 Loop 사이의 관계가 실제 개발 및 운영 과정에서 충분히 검토되었는지 불분명하다.

기존에는 leesh-loop 소스 저장소에서 직접 실행하여 자신을 개발하는 방식에 가까웠다. 중앙 Manager 도입 이후에는 leesh-loop 자체를 일반 관리 대상으로 등록하는 것이 자연스럽고 안전한지, 아니면 별도의 실행·복구 경계가 필요한지 판단해야 한다.

이번 작업의 목적은 특정 구현을 유지하는 것이 아니라 중앙 관리의 이점을 살리면서 전체 경험을 납득 가능하게 만드는 것이다.

단순한 화면 캡처와 기능 테스트만으로 사용 경험을 충분히 검증했다고 판단하지 않는다. 실제 사용 흐름과 상태 변화, 실패 및 복구 경험을 검토할 수 있는 증거를 남긴다.

## Verification Requirements

### VR-1. 일관된 중앙 관리 경험

- 사용자는 현재 선택된 저장소와 Loop의 상태를 쉽게 파악할 수 있어야 한다.
- 저장소 선택, Task 작업, 인스턴스 관리 및 Runtime 관리의 관계와 중요도가 명확해야 한다.
- 자주 사용하는 작업이 상대적으로 드문 관리 기능 때문에 불필요하게 방해받지 않아야 한다.
- 넓은 화면과 좁은 화면 모두에서 핵심 기능을 자연스럽게 발견하고 사용할 수 있어야 한다.
- 기존 화면의 외형이나 배치를 유지하는 것이 개선의 제약이 되어서는 안 된다.

### VR-2. 관리 대상의 완전한 생명주기

- 사용자는 기존 로컬 Git 저장소를 관리 대상으로 등록할 수 있어야 한다.
- 등록 대상과 결과, 생성되는 데이터, 실패 원인을 이해할 수 있어야 한다.
- 이미 등록된 저장소를 중복 등록하거나 잘못된 경로를 지정했을 때 적절하게 처리되어야 한다.
- 더 이상 관리하지 않을 Loop를 관리 목록에서 해제할 수 있어야 한다.
- 관리 해제와 실제 저장소·Task 데이터 삭제는 명확하게 구별되어야 한다.
- 관리 해제 시 실행 중인 작업과 지속 데이터가 의도치 않게 손상되거나 삭제되어서는 안 된다.
- 인스턴스 등록·해제 및 선택 변경 이후에도 다른 인스턴스의 상태가 영향을 받지 않아야 한다.

### VR-3. 이해 가능한 상태와 오류 처리

- 사용자는 Loop의 실제 실행 상태와 관리 작업의 성공·진행·실패를 구별할 수 있어야 한다.
- Failed, Unconfirmed 등 비정상 상태의 의미와 필요한 후속 행동이 이해 가능해야 한다.
- 오류의 중요도와 관련성에 따라 적절한 위치와 강조 수준으로 표시되어야 한다.
- 불필요한 기술적 세부 정보나 과도한 오류 표시가 주요 작업을 방해하지 않아야 한다.
- 오류를 간결하게 표현하더라도 진단에 필요한 정보와 실제 실패 사실이 숨겨져서는 안 된다.
- 오래되거나 다른 인스턴스에 속한 결과를 현재 상태로 오인해서는 안 된다.

### VR-4. 명확한 Runtime 및 Workflow 관리

- Runtime 업데이트가 무엇을 변경하고 무엇을 변경하지 않는지 이해할 수 있어야 한다.
- Source Checkout, 설치된 Runtime, 실행 중인 Manager 및 Loop가 사용하는 버전의 관계가 일관되게 유지되어야 한다.
- 업데이트가 필요하지 않거나 수행할 수 없는 상황을 오해 없이 표현해야 한다.
- Runtime 업데이트와 인스턴스별 Workflow 업데이트를 혼동하지 않아야 한다.
- 업데이트 실패, 부분 적용 및 재시작 필요 여부를 명확하게 확인할 수 있어야 한다.
- 실행 중인 Loop와 지속 데이터는 기존 생명주기 계약에 따라 보호되어야 한다.

### VR-5. leesh-loop 자체의 관리 및 복구 가능성

- leesh-loop 소스 저장소를 관리 대상으로 사용해도 되는지 실제 실행·업데이트 경계를 통해 확인해야 한다.
- 관리 대상인 저장소와 이를 실행하는 Runtime의 차이가 명확해야 한다.
- leesh-loop 자신을 수정하거나 업데이트하는 작업이 예기치 않은 실행 중단이나 관리 불능 상태를 일으켜서는 안 된다.
- Manager 또는 새 Runtime에 문제가 발생해도, 해당 Manager가 정상 동작하는 것을 전제로 하지 않는 진단·복구 경로가 확보되어야 한다.
- 일반 인스턴스와 동일한 계약으로 이 요구를 충족할 수 있다면 별도의 자기 관리 모델을 도입하지 않는다.

### VR-6. 기존 기능과 데이터의 보존

- 기존 Task 발행, 조회, State 변경, Blocked By, 댓글, Workpad 및 Human Review의 의미를 유지해야 한다.
- Manager Service의 종료·재시작이 실행 중인 Loop의 작업을 부당하게 중단하지 않아야 한다.
- 여러 인스턴스의 Task Store, Workflow 및 실행 상태가 혼합되지 않아야 한다.
- 기존 Worker, Symphony, GitHub 연동 및 실행 권한 경계를 유지해야 한다.
- 새로운 관리 기능이나 UI 개선으로 기존에 정상 동작하던 경로에 회귀가 발생해서는 안 된다.

### VR-7. 실제 사용 경험에 대한 검토 가능성

- 주요 관리 작업의 시작부터 결과 확인까지 실제 흐름을 평가할 수 있어야 한다.
- 성공뿐 아니라 의미 있는 실패·대기·복구 상태도 검토 가능해야 한다.
- 기능적으로 동작한다는 사실만으로 UX 개선 완료를 판단하지 않는다.
- 구조, 탐색, 가독성, 정보 위계 및 상호작용의 적절성을 독립적으로 평가할 수 있어야 한다.
- 코드와 테스트만으로 충분히 판단할 수 없는 결과에는 대표적인 사용 경험 증거를 저장소에 보존해야 한다.
- 실제 관찰, 테스트 검증, 설명, 추론 및 합성 자료를 혼동하지 않아야 한다.

## Definitions

- **Source Checkout:** leesh-loop 개발 작업의 대상이 되는 Git 소스 저장소.
- **Runtime Distribution:** 중앙에 설치되는 버전별 불변 실행 코드와 의존성.
- **Manager Service:** 인스턴스 등록, 생명주기 및 관리 작업을 담당하는 중앙 프로세스.
- **Manager UI:** 중앙 관리 기능과 Operator에 접근하는 웹 인터페이스.
- **Loop Instance:** 특정 Git 저장소와 연결된 독립적인 설정, Workflow, Task Store 및 실행 상태를 가진 관리 단위.
- **Loop Process:** 인스턴스의 Task를 처리하는 실행 프로세스.
- **Operator:** Accepted Plan 발행과 Task 진행 상태를 다루는 사용자 작업 인터페이스.
- **관리 해제:** 인스턴스를 중앙 관리 목록과 관리 관계에서 제거하는 작업. Git 저장소 및 지속 데이터의 삭제와 구분한다.
- **자기 관리:** leesh-loop 소스 저장소가 leesh-loop의 관리 대상인 경우.
- **독립 복구 경로:** 정상 작동하는 현재 Manager UI에 의존하지 않고 실행 환경을 진단하거나 정상 상태로 복구할 수 있는 경로.

## Decisions

### 1. 기존 UI는 기준이 아니라 평가 대상이다

PR #120의 화면 구성, 동작 배치와 사용 흐름을 그대로 유지할 필요는 없다.

실제 사용자가 수행하는 Task 작업과 상대적으로 드문 인스턴스·Runtime 관리 작업을 구분하여 UI 구조를 재평가한다.

특정 페이지 수, 탐색 패턴 또는 시각적 표현을 사전에 강제하지 않는다.

### 2. 등록과 관리 해제는 하나의 완결된 관리 능력이다

중앙 Manager는 인스턴스를 추가하는 것뿐 아니라 더 이상 관리하지 않는 대상을 해제할 수 있어야 한다.

관리 해제는 기본적으로 등록 관계를 끝내는 의미로 정의하며, 실제 Git 저장소와 지속 데이터 삭제를 암묵적으로 포함하지 않는다.

실행 중인 Loop의 관리 해제에 필요한 제약과 사용자 행동은 프로세스 소유권 및 데이터 보존 계약을 기준으로 결정한다.

일반적인 삭제 시스템이나 데이터 정리 프레임워크를 별도로 구축하지 않는다.

### 3. Runtime 관리는 사용자에게 이해 가능한 작업이어야 한다

Runtime 업데이트 버튼이 현재 화면에 존재한다는 이유만으로 동일한 표현과 위치를 유지하지 않는다.

업데이트의 필요성, 적용 대상, 기존 실행에 미치는 영향과 완료 후 필요한 행동을 기준으로 관리 경험을 설계한다.

Runtime 및 Workflow의 독립적인 소유권과 업데이트 의미는 유지한다.

### 4. 자기 관리에는 별도의 특권보다 검증 가능한 경계가 우선이다

leesh-loop 자신을 일반 저장소와 동일하게 관리할 수 있다면 그 모델을 우선한다.

다만 실행 시스템 자체에 문제가 생긴 상황에서 같은 시스템을 통한 복구만 허용하는 순환 의존성은 피해야 한다.

기존의 소스 개발, Runtime 설치, 실행 인스턴스 분리 계약을 우선 검토한다.

검증 결과로 필요성이 확인되지 않은 자기 관리 전용 모드나 특수 기능은 도입하지 않는다.

### 5. 안정적으로 동작하는 기존 실행 환경을 이용해 개선한다

이번 개선 작업을 수행하기 위해 검증되지 않은 새 Manager로 작업을 즉시 이전하지 않는다.

현재 동작하는 기존 Operator 경로를 작업 실행 기반으로 사용할 수 있다.

새 Manager의 변경 사항은 격리된 환경에서 검증하며, 안정성이 확인되기 전에 기존 작업을 중단하거나 지속 데이터를 이전하지 않는다.

기존 프로세스 자체를 유지하거나 종료하는 것은 이번 제품 개선의 목표가 아니라 작업 환경을 안전하게 관리하는 문제다.

### 6. 디자인은 실제 경험으로 평가한다

`docs/DESIGN.md`의 사용자 작업 중심 원칙을 따른다.

실제 사용 흐름, 상태 변화, 주요 상호작용과 시각적 결과를 종합하여 평가한다.

단일 정적 캡처를 모든 UX 결과의 근거로 사용하지 않는다. 다만 충분한 증거는 검토할 가치가 있는 결과에 맞춰 선택하며, 모든 상태를 기계적으로 캡처할 필요는 없다.

### 7. 보호할 기존 범위

기존 Task Store의 권위, Accepted Plan의 불변성, Worker dispatch 및 Task 상태 전이 계약을 유지한다.

Codex app-server 내부 프로토콜, sandbox 정책, Symphony 실행 전략 및 일반적인 Git 작업 모델의 재설계는 포함하지 않는다.

파일·모듈·주요 함수의 이름은 실제 책임을 드러내도록 유지하며, 일시적인 구현 맥락에 의존하는 이름을 피한다.

## Planned Units

### Unit 1 — Manager Experience

**Responsibility:** Manager와 Operator의 전체 정보 구조, 탐색 및 시각적·상호작용 경험.

**Outcome:** 사용자는 Task 작업과 관리 작업의 관계를 이해하고 불필요한 탐색 없이 목적을 수행할 수 있다.

### Unit 2 — Instance Lifecycle

**Responsibility:** 인스턴스 등록, 식별, 선택, 시작·종료 및 관리 해제.

**Outcome:** 사용자는 관리 대상을 완전하고 안전하게 관리하며 각 작업의 결과와 영향을 이해할 수 있다.

### Unit 3 — Runtime and Workflow Management

**Responsibility:** Runtime 및 Workflow의 상태, 버전, 변경과 업데이트 경험.

**Outcome:** 사용자는 업데이트의 의미와 적용 범위를 이해하고 예상 가능한 결과를 얻는다.

### Unit 4 — Management Reliability and Recovery

**Responsibility:** 관리자·실행 프로세스의 경계, 상태 정확성, 장애 대응 및 자기 관리 시나리오.

**Outcome:** 일반 인스턴스와 자기 관리 환경 모두에서 안정적인 실행 및 복구 경계가 성립한다.

## Verification

### V-1. 주요 사용자 작업 흐름

**Requirements:** VR-1, VR-7

실제 브라우저에서 저장소 선택, Task 작업, 인스턴스 등록과 관리, Runtime 관리로 이어지는 대표 경로를 수행한다.

데스크톱과 좁은 화면에서 실제 배치와 조작을 검토한다.

**Pass:** 사용자가 주요 작업과 현재 상태를 이해하고 자연스럽게 다음 행동으로 진행할 수 있다. 주요 디자인 판단에 대한 검토 가능한 증거가 존재한다.

**Failure:** 불필요한 탐색, 조작 대상 혼동, 중요한 정보의 발견 실패 또는 검토할 수 없는 디자인 결과.

### V-2. 인스턴스 등록·관리 해제

**Requirements:** VR-2, VR-6

격리된 환경에 실제 로컬 Git 저장소 여러 개를 준비하고 등록·중복 등록·관리 해제를 확인한다.

관리 해제 전후의 Registry, 실제 프로세스와 지속 데이터를 조회한다.

실행 중 및 비정상 상태에서의 관리 해제 제약도 확인한다.

**Pass:** 대상 관리 관계만 의도대로 변경되고 Git 저장소, 보존 대상 데이터 및 다른 인스턴스가 손상되지 않는다.

**Failure:** 해제 불가, 의도하지 않은 데이터 삭제, 프로세스 소유권 위반 또는 다른 인스턴스 변경.

### V-3. 상태와 오류 전달

**Requirements:** VR-3, VR-7

Stopped, Starting, Running, Stopping, Failed 및 Unconfirmed의 대표 상태를 검토한다.

시작 실패, 관리 API 오류, 인스턴스 전환 중 지연 응답과 재시도 등을 확인한다.

실제 관찰 가능한 오류와 재현하기 어려운 오류의 검증 근거를 구별한다.

**Pass:** 표시된 상태가 권위 있는 실제 상태와 일치하고, 오류와 후속 행동을 관련된 문맥에서 이해할 수 있다.

**Failure:** 허위 성공, 오래된 정보, 부정확한 실행 상태, 맥락 없는 오류 또는 필요한 진단 정보의 소실.

### V-4. Runtime과 Workflow 업데이트

**Requirements:** VR-4, VR-6

서로 다른 Runtime 버전을 준비해 설치·활성화·Manager 재시작·인스턴스 재시작의 효과를 확인한다.

현재 사용 중인 Runtime과 신규 버전의 관계, 실행 중인 Loop의 버전 유지, Workflow 차이 비교 및 명시적 적용을 검증한다.

**Pass:** 변경 대상과 실제 효과가 UI 설명에 일치하며 기존 실행과 데이터가 보호된다.

**Failure:** 적용 범위 혼동, 원하지 않는 교체, 데이터 손상 또는 복구 불가능한 부분 적용.

### V-5. 자기 관리와 독립 복구

**Requirements:** VR-5

격리된 환경에서 leesh-loop 소스 저장소를 관리 대상으로 사용하는 대표 시나리오를 검증한다.

소스 변경과 Runtime 업데이트를 구분해 관찰하고, 관리 프로세스가 사용할 수 없는 상황에서도 복구 경로가 존재하고 작동하는지 확인한다.

**Pass:** 자기 관리를 일반 인스턴스 계약으로 안전하게 수행할 수 있거나, 실제로 필요한 경계가 명확히 구현되어 있다. 복구 경로가 정상적인 Manager 동작에 순환 의존하지 않는다.

**Failure:** 자기 업데이트에 따른 부당한 작업 중단, 관리 불능 상태 또는 작동하지 않는 복구 경로.

### V-6. 기존 작업 기능 및 실행 계약

**Requirements:** VR-6

기존 테스트와 Local E2E를 실행하고 Task 발행, 상태 변경, Workpad, Human Review 및 Manager와 Loop의 독립 생명주기를 확인한다.

권위 있는 Task Store와 OS 프로세스 상태를 직접 확인한다.

**Pass:** 기존 작업 의미와 데이터 격리 및 실행 계약이 유지된다.

**Failure:** 기능 회귀, 상태 불일치, 작업 유실 또는 불필요한 실행 중단.

### V-7. 디자인 결과의 증거

**Requirements:** VR-1, VR-2, VR-3, VR-4, VR-7

실제 사용 경험에서 평가할 가치가 있는 주요 결과를 식별하고, 해당 결과가 검토 가능하도록 대표 자료를 보존한다.

자료는 필요에 따라 상태별 화면, 연속된 상호작용, 동작 설명, 테스트 결과 및 실제 데이터 조회 등을 사용한다.

UI 관련 자료는 기존 `docs/ui-evidence/` 관례를 따른다.

**Pass:** 독립 리뷰어가 실제 구현, 동작 및 디자인 의도를 충분히 검토할 수 있다.

**Failure:** 중요한 결과를 판단할 합리적인 증거가 부족하거나 합성 자료를 실제 실행의 증거로 오인하는 경우.

### Verification limitations

격리된 테스트와 제어 가능한 Worker만으로 실제 외부 서비스와 모든 사용자 환경에서의 결과를 입증할 수는 없다.

직접 검증하지 못한 영역은 가장 가까운 유효한 증거, 한계와 남는 불확실성을 명시한다.

검증에 필요한 관측 수단이 합리적인 범위에서 부족하다면 해당 검증을 가능하게 하는 작업도 수행 범위에 포함한다.

## Execution evidence update (2026-10-26)

The Accepted Plan remains unchanged. These notes record the evidence method and limits discovered during execution and the independent Reviewability Preparation.

- **V-1 / V-7:** The actual Chrome session exercised repository selection, registration and duplicate/error paths, Task publication and switching, Workflow comparison, Runtime no-change update, unregistration readback, and the 390×844 CSS layout. The final Runtime identity-label change happened after that browser session. A later attempt to open a local file bootstrap for final captures was rejected by the browser URL policy, which prohibited serving that same page by another route. The stored desktop/narrow SVGs are therefore clearly labeled synthetic reconstructions from the final JSX/CSS, not direct browser captures. Their rendered result is available for design review, but it does not claim direct observation.
- **V-4:** Installing and activating the source Runtime through `node bin/leesh-loop.mjs update` was directly observed in an isolated XDG profile. The no-change Manager update path was observed earlier. The different-ID, same-version, Manager-restart/Loop-pinning sequence is a synthetic fixture; no changed Runtime was applied while a Loop was running.
- **V-5:** In the same isolated profile, the source checkout was registered as a normal `Stopped` instance. After confirming no Manager process and a refused loopback status request, invoking `node bin/leesh-loop.mjs list` returned the same registry entry and wrote a new Manager service identity. This exercised CLI recovery after Manager unavailability. No Loop was started, and recovery from a damaged Runtime remains unverified.
- **V-6:** Root `npm test` passed 172/172. The Local E2E attempts did not reach Worker dispatch because Symphony startup timed out during compilation and then during a locked retry. `mix test` could not build the Lexbor NIF because `cmake` is unavailable. The detailed run identities and limits are in `docs/ui-evidence/manager-lifecycle-reassessment.md`.
- **V-2 / V-3:** Independent Behavior review identified that a confirmed process-absent `Failed` Loop could not be unregistered and that shared Runtime controls vanished with an empty registry. The Manager now allows registry-only removal for `Stopped` or `Failed` with the existing confirmed-absence signal; focused integration evidence confirms active/uncertain Failed and Starting are rejected while confirmed-absent Failed succeeds with repository, Task Store, and other-instance preservation. A no-instance integration flow confirms the Runtime read and install action remain available and restart need is reported. The focused Manager tests, UI tests, source regression checks, and UI production build passed. Updated visual fixtures are synthetic, not browser observations; details and limits are recorded in `docs/ui-evidence/manager-lifecycle-reassessment.md`.
- **V-3 / V-7:** Design review found that Failed-state guidance pointed to logs/Workflow below the Task workspace while `Start Loop` retained primary action status. The header now gives `Review failure` primary placement and `Retry Loop` secondary placement; the former opens Manager controls and Logs, scrolls to the log panel, and focuses its summary. The existing Task-first hierarchy remains for ordinary work. This is verified by source regression checks and the production UI build. A synthetic full-page flow map records the position of Tasks and the recovery destination; direct post-change browser interaction remains unavailable under the existing browser URL policy limit.
- **V-3 / V-7:** The Design re-review confirmed the Failed-state recovery finding was resolved and identified that `Unconfirmed` also needed a safe next step. `Review ownership` now opens the current diagnosis and Manager Logs, focuses diagnosis, and supplies a Logs link; Start/Stop/Unregister remain unavailable and guidance asks users to verify the assigned port's process before retrying. UI status mapping/source checks and the production build pass. A synthetic full-page Unconfirmed flow map distinguishes this intended path from browser observation; direct post-change interaction remains unavailable under the existing browser URL policy limit.
- **V-2 / V-6:** Behavior review Job `779b4e0f-f17c-4b56-aefd-a75b3884115e` found the target Loop's in-flight Task drain occupied the global registry queue, delaying unrelated registration or unregistration. The per-instance gate, drain, and Task Store close still complete before removal, while the global queue now covers only the final registry mutation. The integration test holds Loop A's Task request open, observes the unregister-in-progress 409 from a fresh request, and then confirms Loop B can register before A's drain finishes; registry and Task Store isolation are read back. Manager integration/source checks passed 46/46, Operator UI tests passed 57/57, and the UI build passed.
- **V-3:** The same Behavior review found confirmed process-absent `Failed` guidance could label an unexpected runtime exit as a startup failure. The user-facing guidance is now phase-neutral while keeping diagnosis and log direction. A focused source assertion and the Manager/Operator checks above pass.
- **V-6 full-suite limit:** A new root `npm test` run passed 173/174 tests. The sole failure was `operator/app/test/update.test.mjs`, where Runtime dependency setup could not install Erlang/Elixir through `mise` because the sandbox filesystem is read-only. The changed Manager tests, Operator UI checks, and production UI build passed independently; the root failure is environment-limited, not evidence of a code regression.
- **V-7 evidence fidelity:** Reviewability Preparation Job `67d07d5f-bbc9-4133-9e44-219401fb67dc` found that two synthetic Failed-state SVGs still used the superseded startup-specific wording after the JSX had become phase-neutral. Both SVGs now match the current UI copy, retain their synthetic labels, and were rendered and visually checked again. No new browser capture is claimed; Preparation must be repeated on the resulting PR head.
- **V-7 preparation readback:** Reviewability Preparation Job `1426aef7-54ac-4435-8f08-8b536acfff36` returned PASS on PR #121 HEAD `0c200e0376bf410a8571a6bad6c038ad0d733e75`. It confirmed the stale-copy fixture finding is resolved and the material outcomes have reasonable source, test, readback, narrative, and synthetic representations. It did not rerun tests or browser actions; documented browser, full Local E2E, and changed-Runtime handoff limits remain.
- **V-3:** Behavior review Job `ce5baaa9-50fd-4df6-bab8-8cdff860be84` confirmed the registry-drain and confirmed-absent guidance fixes, then found another valid Failed shape without `can_stop` or `can_update_workflow` still fell through to startup-specific copy. The guidance mapping is now a small pure UI helper with separate tests for process-absent, process-owned, and phase-unspecified Failed states. The unexpected-exit Manager test explicitly verifies the latter state shape. Focused Manager/source tests passed 46/46, UI tests passed 60/60, and the production UI build passed.
- **V-2 / V-6 verification determinism:** Maintainability review Job `73749fa5-c7ed-4bd5-9bdd-b4b6205b68dd` found a fixed 40 ms delay did not prove the unregister reservation had begun before the unrelated registration test. The test now waits for an explicit fresh-Task-request 409 before starting Loop B registration. Follow-up Jobs `8d320fe7-fb1e-4c5a-8d84-013efd4eee36` and `19d07206-780a-4b07-90a5-4ac137826f5b` identified that a probe could block before reservation and that other awaits could bypass cleanup. Each probe now has a 250 ms request timeout; the opener barrier, reservation, registration, final joins, and final independent Task read have labeled five-second bounds; `finally` releases the Store gate and bounds pending cleanup. The Manager integration file passes 39/39 after these changes.

## Verification Tools

| Tool | Responsibility |
|---|---|
| Node.js 테스트 | Manager API, 등록·해제, Runtime·상태 계약 |
| Elixir `mix test` | Symphony 및 Worker 실행 계약 |
| Local E2E | 실제 실행 및 Task 흐름 |
| 격리된 XDG 환경 | 기존 실행과 분리된 설치·관리 검증 |
| 실제 브라우저 | 탐색, 상호작용, 상태와 시각적 품질 |
| OS 프로세스·포트 관측 | 실행 소유권 및 생명주기 |
| SQLite 직접 조회 | 지속 데이터와 Task 상태 검증 |
| Git 및 Runtime 버전 관측 | 소스·설치본·실행 버전의 구분 |
| 저장소 내 대표 UX 증거 | 독립적인 디자인 평가 |

## Out of Scope

- 기존 인스턴스의 포괄적인 자동 마이그레이션
- 무조건적인 기존 프로세스 종료 또는 제거
- 원격 다중 사용자 Manager
- 범용 데이터 삭제 및 정리 시스템
- 자동 Runtime 업데이트와 Workflow 자동 병합
- Codex app-server와 sandbox 정책의 재설계
- Symphony의 일반적인 Task dispatch 정책 변경
- 필요성이 입증되지 않은 자기 관리 전용 아키텍처
