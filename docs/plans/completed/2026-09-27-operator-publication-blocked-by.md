# 2026-09-27-operator-publication-blocked-by

## Objective

Operator UI에서 새 Plan을 publish할 때 현재 project의 기존 task 중 하나 이상을 `Blocked By`로 지정하고, publication이 완료된 task가 처음부터 해당 canonical relation을 가진 상태로 생성되도록 한다.

## Intent

사용자는 Operator UI가 현재 project task로 제공하는 task 중 blocker로 삼을 task를 직접 골라 publication context에 추가할 수 있어야 한다.

구체적인 interaction 형태는 현재 Operator UI의 실제 구조와 task access 방식에 맞춰 구현에서 정한다.

UI/UX 결정은 `2026-09-27-operator-task-ui`가 중시하는 관점과 같은 기준으로 해소한다. 특정 widget이나 화면 구조를 먼저 정하기보다 실제 사용 흐름에서 필요한 정보와 행동의 우선순위, 기존 task 확인 흐름과 publication 흐름의 연결, responsive behavior, authority boundary, 정보 위계를 중심으로 판단한다.

특히 다음을 중시한다.

- blocker 선택이 기존 task 확인 경험과 publication 경험 사이에 자연스럽게 연결되는가.
- 사용자가 어떤 task를 blocker로 지정하는지 빠르게 이해할 수 있는가.
- `Title`, `State` 등 blocker 식별에 필요한 정보가 선택 과정에서 충분히 드러나는가.
- blocker 선택 기능이 Plan 입력, State 결정, Publish action과 적절한 위계로 배치되는가.
- 현재 task surface의 information hierarchy와 interaction model을 불필요하게 중복하거나 경쟁하지 않는가.
- wide/narrow viewport에서 blocker 선택의 의미와 usability가 유지되는가.
- typography, spacing, sizing, alignment, grouping, placement만으로도 선택 상태와 publication context가 이해되는가.
- implementation 편의를 위해 Publisher 또는 Notion authority가 client UI에 복제되지 않는가.
- task loading/polling 방식 때문에 blocker 선택 interaction이 불안정하거나 사실상 사용할 수 없게 되지 않는가.

Blocker 후보 범위는 현재 Operator UI가 정상적인 project task surface로 제공하는 task 범위와 일관되게 유지할 수 있다.

현재 task surface가 여러 page, progressive loading 또는 다른 staged loading 방식을 사용한다면, 사용자가 합리적인 interaction을 통해 blocker로 사용할 task에 도달한 뒤 선택할 수 있어야 한다. Task loading 구조 때문에 정상적으로 접근 가능한 task가 blocker 선택에서는 구조적으로 선택 불가능해지는 결과는 허용하지 않는다.

사용자가 선택한 blocker는 UI가 publication 이후 별도로 수정하는 값이 아니라 기존 Publisher publication input의 일부다.

Publication 성공 시 canonical task는 requested `Blocked By` relation을 이미 가지고 있어야 한다.

기존 Publisher가 Notion write authority, publication lifecycle, canonical task/Plan representation 및 failure semantics를 계속 소유한다.

이 작업을 실행하는 데 필요한 runtime Project configuration이 repository에 존재하지 않거나 현재 checkout에서 사용할 수 없는 경우, worker는 실행에 필요한 `project.json`을 직접 구성할 수 있다.

해당 파일이 `.gitignore` 대상이거나 local-only runtime configuration이라는 이유만으로 작업을 중단하거나 Human Review를 요구해서는 안 된다. 필요한 값은 repository의 existing Project shape, example/default configuration, 현재 environment 및 실행 대상 repository 정보를 기준으로 구성한다.

직접 만든 `project.json`은 이 작업을 실행하고 검증하기 위한 local runtime input으로 취급하며, 별도의 제품 artifact로 요구되지 않는 한 tracked source로 추가할 필요는 없다.

## Verification Requirements

- Operator UI의 Plan publication 흐름에서 기존 task를 하나 이상 `Blocked By` 대상으로 선택할 수 있어야 한다.
- blocker 선택은 현재 Operator UI의 task surface와 자연스럽게 연결되어야 한다.
- UI/UX 결과는 `2026-09-27-operator-task-ui`와 같은 리뷰 관점으로 판단해야 한다.
- blocker 선택이 기존 task 확인 흐름과 publication 흐름을 끊거나 별도의 독립 workflow처럼 느껴져서는 안 된다.
- blocker 후보는 raw page ID만으로 제시되지 않아야 하며, 사용자가 task를 식별할 수 있는 충분한 task 정보가 보여야 한다.
- 선택된 blocker는 publication 전에 사용자가 현재 publication context의 일부로 명확히 확인할 수 있어야 한다.
- `Cancelled` 등 현재 정상 task surface에서 제외되는 task를 blocker 후보로 반드시 지원할 필요는 없다.
- blocker candidate 범위는 현재 Operator UI가 제공하는 정상 task 범위와 일관되게 둘 수 있다.
- 현재 task surface가 pagination, load-more, progressive loading 또는 그 밖의 staged access 방식을 사용하더라도, 사용자가 해당 interaction을 통해 접근 가능한 task는 blocker selection에서도 합리적으로 선택할 수 있어야 한다.
- 복수 blocker를 선택할 수 있어야 한다.
- blocker를 지정하지 않는 기존 publication은 현재 behavior를 유지해야 한다.
- React client가 Notion API를 직접 호출하거나 `Blocked By` relation을 직접 수정해서는 안 된다.
- Publisher는 optional blocker identity 목록을 publication input으로 받아 canonical task source의 실제 task인지 검증해야 한다.
- requested blocker relation은 final publication State 전환 전에 canonical task에 기록되어야 한다.
- incomplete / `Publisher Pending` retry 및 recovery에서도 requested blocker context가 유실되어서는 안 된다.
- relation write 또는 blocker validation 실패 시 일부만 적용된 successful publication으로 완료되어서는 안 된다.
- Publish 실패 후 재시도할 때 Plan, State 및 선택한 blocker context가 유지되어야 한다.
- 실제 UI에서 사용자가 task를 blocker로 선택해 새 task를 publish하고, authoritative Notion readback에서 relation이 올바르게 설정되었음을 확인해야 한다.
- wide/narrow viewport에서 blocker 선택과 publication action의 정보 순서와 usability가 유지되어야 한다.
- UI evidence를 통해 blocker 후보 식별, 선택 상태, publication context 내 배치, task surface와의 연결, responsive behavior 및 실제 publication 결과를 판단할 수 있어야 한다.
- 복수 blocker와 blocker 없음 경로를 각각 검증해야 한다.
- 실행 또는 검증에 필요한 `project.json`이 없는 경우 worker가 직접 local runtime Project를 구성하여 실제 Operator 경로를 실행할 수 있어야 하며, 해당 파일이 gitignored/local-only라는 이유로 검증을 생략하거나 작업을 중단해서는 안 된다.

## Definitions

- **Blocker candidate**: 현재 Operator UI의 정상 project task surface에서 제공되어 `Blocked By` 대상으로 선택할 수 있는 기존 task.
- **Publication context**: Plan 내용, 최종 State, 사용자가 선택한 blocker identity를 포함해 기존 Publisher로 전달되는 입력.

## Decisions

- UI는 project task surface에서 이미 제공되는 task 접근 흐름을 사용하고, 선택한 task를 publication context에서 확인할 수 있도록 연결한다.
- React client는 blocker 선택과 publication input 전달만 담당한다. Notion write authority, blocker 검증 및 relation persistence는 기존 Publisher가 담당한다.
- Blocker identities는 optional publication input이다. 값이 없으면 기존 publication 동작을 유지한다.
- 필요한 `project.json`은 repository의 `operator/project.example.json`, project defaults, 실행 환경 및 repository 정보를 사용해 local-only runtime input으로 구성할 수 있다.

## Verification

- 관련 Operator UI, Operator server 및 Publisher 구현을 확인하고 기존 task surface와 publication 입력 경계를 따라 변경을 검토한다.
- 프로젝트의 기존 검증 명령으로 blocker 없음, 단일/복수 blocker, task candidate 접근과 loading, Publisher validation 및 relation-write/retry 실패 동작을 검증한다.
- 실제 Operator UI를 wide 및 narrow viewport에서 열어 task를 식별하고 여러 blocker를 선택해 publication context를 확인한다. 별도 blocker가 없는 publication도 같은 UI 흐름에서 확인한다.
- Operator UI의 정상 Publish 흐름으로 canonical task를 생성하고, Notion의 authoritative readback에서 State 및 `Blocked By` relation을 확인한다. UI screenshot과 실제 publication 결과를 evidence로 보존한다.
- Repository Plan을 실제 변경 결과와 대조하고, Accepted Plan의 범위·authority boundary·failure semantics가 그대로 유지되었는지 확인한다.

현재 실행 환경에는 CUA browser/app surface가 없어 실제 화면 조작과 wide/narrow screenshot을 수행할 수 없다. 가장 가까운 실제 경로로 로컬 Operator server의 task 및 publication endpoint, 기존 Publisher, Notion task reader를 통과해 복수 blocker와 blocker 없음 publication을 확인한다. 이 경로는 publication persistence와 canonical relation을 증명하지만 React control interaction, 시각적 hierarchy 및 responsive layout은 증명하지 않으므로 해당 부분은 browser surface가 제공될 때까지 미검증으로 남긴다.

## Verification Tools

- Operator UI in a browser: task selection, publication context, responsive layout 및 Publish action의 실제 흐름을 확인한다.
- Operator server / Publisher: publication input, candidate validation, canonical relation write 및 failure/retry 동작을 확인한다.
- Notion task UI / canonical task surface: 생성된 task의 State 및 `Blocked By` relation을 authoritative readback으로 확인한다.
- Repository test/build commands: 기존 UI, server, Publisher 경로의 회귀 동작을 확인한다.
- Browser screenshots: wide/narrow viewport의 후보 식별, 선택 상태 및 publication context를 기록한다.
