# 2026-10-05-documentation-and-usage-surface

## Objective

Leesh Loop의 문서, 사용자에게 노출되는 실행 안내, 용어와 표현을 실제 사용 흐름에 맞게 정리하여, 처음 사용하는 사람이 제품의 목적과 사용 방법을 빠르게 이해하고 필요한 행동을 수행할 수 있는 상태로 만든다.

불필요하게 분산된 문서는 제거하거나 통합하고, 유지되는 문서는 각자의 명확한 역할을 갖도록 한다.

## Intent

현재 문서는 실제 사용자가 알아야 할 정보와 내부 구현·운영 계약, 에이전트가 실행 중 해석해야 할 지침이 여러 문서에 걸쳐 섞여 있다.

README는 제품을 처음 접하거나 실제로 사용하는 사람이 읽는 문서에 가깝게 만들고, 설치·초기화·시작·작업 게시·상태 확인과 같은 실제 사용 흐름과 화면을 중심으로 설명한다.

반대로 WORKFLOW.md와 init에서 생성되는 workflow는 사람이 처음부터 끝까지 직접 읽고 이해하는 일반 사용자 문서로 취급하지 않는다. 이 문서들은 에이전트가 작업 시 읽고 실행 의도와 계약을 해석하는 운영 입력이라는 실제 사용 방식을 숨기지 않고 명시한다. 사람이 세부 내용을 이해하거나 수정해야 할 때도 에이전트를 통해 읽고 해석하는 사용 방식이 자연스럽게 드러나야 한다.

DESIGN.md, PLAN.md처럼 제품이나 작업 방식의 상위 원칙을 지속적으로 보존하는 문서는 단순 문서 수 감소를 이유로 없애지 않는다. 반면 특정 하위 구성 요소나 과거 구현 과정 때문에 독립 문서가 된 내용은 별도 문서로 유지할 필요가 있는지 다시 판단하고, 가능한 경우 README 또는 하나의 더 상위 수준 문서로 통합한다.

필요한 내부 설명을 README에 다시 밀어 넣어 README를 비대하게 만들기보다는, 제품 전체의 구조와 책임 경계를 설명할 독립적인 상위 문서 하나가 실제로 필요한 경우 그 문서를 두고 세부 문서들을 그 아래로 압축하는 방향을 선호한다.

문서뿐 아니라 npm start, init 및 주요 실패 경로에서 사용자에게 보이는 문구도 같은 기준으로 다룬다. 구현 내부 단계의 이름을 그대로 노출하기보다 사용자가 현재 무슨 일이 일어나고 있고 필요한 경우 무엇을 해야 하는지 이해하는 데 도움이 되는 표현을 사용한다.

전반적인 정리는 KISS, YAGNI, DRY를 기준으로 하며, 같은 사실이나 계약을 여러 문서와 사용자 표면에 반복해 유지하지 않는다.

## Verification Requirements

- README만으로 처음 사용하는 사람이 Leesh Loop가 무엇인지, 어떤 방식으로 다른 repository에 연결되는지, 필요한 준비가 무엇인지, init 이후 어떻게 시작하고 실제 작업을 게시·확인하는지 이해할 수 있어야 한다.
- README는 실제 사용자에게 필요한 설명을 중심으로 구성되어야 하며, Publisher 내부 자료구조, readiness 내부 프로토콜, E2E 구현 세부사항처럼 정상적인 사용을 위해 알 필요가 없는 내부 계약이 주된 설명 흐름을 차지하지 않아야 한다.
- 실제 UI의 현재 사용 흐름과 화면이 README 설명에 반영되어야 하며, 대표적인 현재 화면 캡처를 통해 사용자가 시작 후 무엇을 보게 되는지 확인할 수 있어야 한다.
- WORKFLOW.md와 init에서 생성되는 workflow가 에이전트 실행 계약이라는 실제 역할이 명확하게 표현되어야 한다. 이를 일반 사용자가 수동으로 숙지해야 하는 사용 설명서처럼 안내해서는 안 된다.
- init에서 사용되는 workflow template과 생성된 workflow 사이의 관계가 실제 동작과 일치하게 설명되어야 하며, 생성된 Loop가 어떤 workflow를 사용하게 되는지 사용자가 이해할 수 있어야 한다.
- 독립적으로 존재하는 각 비계획 문서는 유지해야 할 명확한 책임을 가져야 한다. 독립적인 책임이 없는 문서는 삭제하거나 책임이 가장 가까운 문서로 병합되어야 한다.
- 제품 전체의 구조나 지속적인 시스템 계약을 담기 위해 별도 상위 문서가 필요한 경우에는 하나의 명확한 상위 문서로 통합하고, 같은 목적의 세부 문서를 다시 여러 개 유지하지 않아야 한다.
- DESIGN.md, PLAN.md, active/completed Plan과 같이 상위 원칙 또는 작업 계약 자체를 보존하는 문서 체계는 문서 정리를 이유로 의미가 손실되지 않아야 한다.
- 문서 이동·삭제·병합 이후 repository 내부의 문서 링크와 실행 과정에서 제공되는 문서 참조가 존재하지 않는 경로를 가리키지 않아야 한다.
- 제품, README, workflow/template, UI, CLI 출력에서 같은 개념에는 같은 용어를 사용해야 하며, 동일한 개념을 서로 다른 이름으로 표현하거나 내부 구현 용어가 불필요하게 사용자 용어로 노출되는 주요 불일치가 남지 않아야 한다.
- npm start와 주요 사용자 실행 경로의 출력은 실제 진행 상황과 결과를 정확하게 표현해야 하며, 사용자가 내부 구성 요소의 세부 lifecycle을 이해해야만 의미를 파악할 수 있는 문구를 정상 사용 흐름의 중심에 두지 않아야 한다.
- 문서 및 표현 정리는 기존 Operator, Publisher, Symphony, workflow, init의 실행 책임이나 lifecycle 계약을 의도하지 않게 변경하지 않아야 한다.

## Definitions

- 사용자 문서: 제품을 설치·초기화·실행하고 실제 작업을 수행하는 사람이 직접 읽는 것을 주된 목적으로 하는 문서.
- 에이전트 실행 계약: 작업을 수행하는 에이전트가 실행 시 읽어 repository별 정책, lifecycle, 책임 및 허용된 행동을 해석하는 문서. WORKFLOW.md와 init workflow가 이에 해당한다.
- 상위 원칙 문서: 특정 구현 세부사항보다 오래 유지되며 여러 변경의 판단 기준으로 사용되는 문서. 현재 DESIGN.md와 PLAN.md가 이에 해당한다.
- 시스템 문서: 일반적인 사용법은 아니지만 Leesh Loop 전체의 구조, 책임과 지속적인 내부 계약을 이해하기 위해 필요한 설명을 하나의 관점에서 제공하는 문서. 실제 정리 과정에서 독립 문서가 필요하다고 확인될 때만 둔다.
- 사용자 표면: README, Operator UI, CLI/start/init 출력처럼 사용자가 정상적인 제품 사용 과정에서 직접 접하는 설명과 표현.

## Decisions

### 문서 책임을 독자 기준으로 정리한다

README.md의 책임은 제품 소개와 실제 사용이다.

README의 주된 흐름은 다음과 같은 사용 경험을 설명하는 데 집중한다.

1. Leesh Loop가 무엇을 하는가.
2. 어떤 repository에 사용할 수 있는가.
3. 필요한 사전 준비는 무엇인가.
4. 대상 repository에서 init하면 무엇이 만들어지는가.
5. 생성된 Loop를 어떻게 시작하는가.
6. Operator UI에서 Plan을 게시하고 task 상태를 어떻게 확인하는가.
7. workflow는 어떤 역할이며 평소에는 어떻게 다루는가.
8. 문제가 있을 때 사용자가 어디부터 확인하는가.

현재 README에 있는 readiness 내부 절차, Publisher schema, E2E resource management, Symphony 내부 orchestration 등의 상세 설명은 이 흐름에 직접 필요하지 않으면 README에서 제거한다.

### 실제 사용 화면을 README의 일부로 취급한다

현재 Operator UI의 대표적인 wide/narrow 화면 중 실제 사용을 가장 잘 설명하는 캡처를 README에서 사용한다.

캡처는 단순 장식이나 전체 UI gallery가 아니라, 사용자가 npm start 이후 보게 되는 화면과 핵심 작업 흐름을 설명하는 증거로 사용한다.

리뷰용 docs/ui-evidence/ 전체를 사용자 문서용 이미지 집합으로 취급하지 않는다. README가 참조하는 장기적인 사용자 설명용 이미지와 변경 검토를 위한 UI evidence의 역할은 구분한다.

### workflow를 실제 소비 방식대로 설명한다

WORKFLOW.md와 docs/WORKFLOW_TEMPLATE.md는 일반적인 튜토리얼 문서가 아니라 에이전트가 실행 시 소비하는 계약으로 설명한다.

README에서는 workflow 전체 내용을 재설명하지 않고 다음을 사용자가 이해할 수 있게 한다.

- 왜 workflow가 존재하는지
- init 시 어떻게 생성되는지
- repository마다 무엇이 달라질 수 있는지
- 평상시 사용자가 직접 읽고 모든 규칙을 숙지할 필요는 없다는 점
- 정책을 확인하거나 수정해야 할 때 에이전트를 통해 문서를 읽고 의도를 해석·수정하는 방식이 자연스러운 사용법이라는 점

workflow/template 자체의 문체는 에이전트가 정확하게 해석할 수 있는 계약이라는 현재 역할을 우선한다. 사람에게 읽기 쉬워 보이게 만들기 위해 실행 계약을 느슨하게 만들지 않는다.

### 세부 문서는 기본적으로 병합 대상으로 본다

현재 별도 문서인 PROJECT_CONFIGURATION.md와 NOTION_PLAN_PUBLISHER.md는 독립적인 최종 사용자 작업 흐름을 제공하는 문서가 아니므로 유지 필요성을 다시 판단한다.

일반 사용에 필요한 configuration은 README의 setup/configuration 흐름으로 흡수한다.

Publisher와 configuration의 상세 계약처럼 사용자 README에 넣기에는 지나치게 내부적이지만 계속 보존할 가치가 있는 내용은 여러 소규모 문서를 그대로 유지하기보다 하나의 시스템 수준 문서로 통합한다.

그러한 지속적인 내부 설명이 실제로 남지 않는다면 새로운 시스템 문서를 만들지 않는다.

### 상위 원칙 문서는 독립성을 유지한다

DESIGN.md와 PLAN.md는 각각 UI/UX 판단 원칙과 계획 생성 계약이라는 독립된 상위 책임을 가지고 있으므로, 단순한 문서 수 감소를 목적으로 README나 시스템 문서에 병합하지 않는다.

WORKFLOW.md 역시 실행 계약 자체이므로 사용자 설명 문서와 병합하지 않는다.

AGENTS.md는 repository에서 에이전트가 작업할 때 필요한 repository-level instruction이라는 현재 책임을 기준으로 검토하고, README에 사용자 설명을 중복시키는 내용만 제거한다.

### 문서 구조 자체를 작은 navigation으로 만든다

정리 후 README에서 추가 문서를 소개할 때는 “더 많은 문서” 목록을 만드는 대신 각 문서를 왜 볼 수 있는지가 드러나는 최소한의 navigation만 제공한다.

계획 기록과 UI review evidence처럼 제품 사용 문서가 아닌 repository 작업 산출물은 일반 사용자 문서 목록과 구분한다.

### 사용자 용어를 하나로 맞춘다

문서 정리와 함께 README, Operator UI, start/init 출력, workflow 주변 설명에서 사용되는 주요 명사를 조사하고 canonical terminology를 정한다.

특히 Project, Loop, target repository, Operator, Plan, task, State, Workpad, workflow와 같이 사용자와 내부 시스템 모두에 등장하는 용어는 같은 의미에 같은 이름을 사용한다.

내부 구현 단계나 모듈 이름이 사용자 행동을 설명하는 더 직접적인 표현보다 우선하지 않게 한다.

### 실행 출력도 문서와 같은 제품 표면으로 다룬다

npm start와 init의 정상 경로 및 대표적인 실패 경로를 실제 사용자 관점에서 검토한다.

진행 출력은 현재 무엇을 준비하고 있는지 이해할 정도의 정보만 제공하고, 정상적인 실행에서 내부 subsystem의 세부 단계가 연속적으로 노출되어 사용자가 이를 운영해야 하는 것처럼 보이지 않게 한다.

실패 출력은 원인과 사용자가 취할 수 있는 다음 행동이 이미 알려져 있는 경우 이를 직접 설명한다.

machine-readable 결과나 자동화가 의존하는 출력 계약이 있다면 사람용 표현 정리를 위해 깨뜨리지 않는다.

### 기존 실행 책임은 보호한다

이번 작업은 documentation와 user-facing wording 정리다.

Operator readiness 정책, Publisher publication semantics, Symphony dispatch/lifecycle, Notion State authority, Blocked By semantics, workflow lifecycle, init이 생성하는 runtime 구조 자체를 변경하지 않는다.

문서 정리 과정에서 실제 behavior 변경이 필요하다고 확인되는 경우, 문서와 표현을 실제 behavior에 맞추는 데 필요한 범위를 넘어서는 변경은 별도 계획으로 분리한다.

파일, 모듈, 타입과 주요 함수 이름을 수정하는 경우에도 현재 실제 책임을 더 정확하게 드러내는 이름만 사용한다. 이번 작업을 계기로 존재하지 않는 새 abstraction을 이름으로 먼저 도입하지 않는다.

## Verification

### README 실제 사용성

repository를 처음 접하는 사용자의 경로로 README를 처음부터 따라간다.

README의 안내만을 출발점으로 하여 설치/준비 조건, 대상 repository init, 생성 결과, start, Operator UI 진입, Plan 게시와 task 확인까지 필요한 행동을 찾을 수 있는지 확인한다.

각 단계에서 README가 가리키는 명령, 파일 및 UI가 현재 repository의 실제 동작과 일치하는지 readback한다.

### init과 workflow 설명

실제 leesh-loop init 경로를 대표 대상 repository에 실행하거나 기존 init 통합 검증 경로를 사용하여 생성된 Loop의 workflow를 확인한다.

생성된 workflow가 현재 template에서 유래하고 실제 runtime에서 사용되는 경로와 README 설명이 일치하는지 확인한다.

workflow를 직접 숙지해야 한다는 전제를 README가 만들지 않는지, 반대로 workflow의 역할과 수정 지점은 충분히 찾을 수 있는지 함께 검토한다.

### 문서 consolidation

변경 전후의 비계획 문서 목록을 비교한다.

남아 있는 각 문서가 README 사용자 설명, 에이전트 계약, 상위 원칙, 시스템 설명 중 하나의 독립적인 책임을 가지는지 확인한다.

삭제하거나 이동한 문서명 및 경로를 repository 전체에서 검색하여 stale link와 stale reference가 없는지 확인한다.

### 화면과 설명의 일치

README에 포함되는 현재 UI 캡처와 실제 Operator UI를 비교한다.

README가 설명하는 주요 UI 구조와 행동이 현재 화면에서 실제로 발견되고 수행될 수 있는지 확인한다.

문서용 캡처가 변경된 UI를 잘못 설명하지 않는 상태인지 확인한다.

### 사용자 출력

npm start의 실제 정상 시작 경로를 실행하여 사용자에게 노출되는 진행 문구와 최종 결과를 캡처한다.

대표적인 configuration/readiness 오류 중 현재 지원되는 검증 경로를 통해 재현할 수 있는 경우 해당 출력도 확인한다.

문구가 실제 상태를 정확하게 설명하는지, 정상적인 사용자가 내부 lifecycle 지식 없이 의미를 파악할 수 있는지, 기존 machine-readable 결과 계약이 유지되는지 확인한다.

init의 정상 실행 및 대표적인 입력 오류도 같은 기준으로 확인한다.

### 용어 일관성

README, 유지된 일반 문서, workflow/template 주변 설명, Operator UI와 주요 CLI 출력에서 canonical terminology를 검색한다.

같은 개념을 의미하는 이전 표현이 남아 있는 경우 실제로 별도 의미인지 확인하고, 별도 의미가 아니라면 통일한다.

### 회귀 검증

기존 Operator/init focused tests를 실행하여 문서와 user-facing wording 변경으로 기존 실행 계약이 손상되지 않았음을 확인한다.

workflow/template 내용이 수정된 경우 해당 계약을 검증하는 현재 repository 검증과, init 결과에서 생성된 workflow readback을 함께 사용한다.

UI 설명이나 사용자 노출 문구 변경으로 UI 자체를 수정한 경우 현재 repository의 UI 검증 및 필요한 rendered evidence를 갱신하여 확인한다.

## Verification Tools

- GitHub repository tree / code search: 현재 문서 구조, 모든 문서 참조, 중복된 용어와 stale path를 확인한다.
- README 및 Markdown rendering: 최종 사용자 문서의 구조, 링크, 이미지와 실제 읽기 흐름을 확인한다.
- leesh-loop init / init tests: 실제 생성 결과와 workflow template 관계를 확인한다.
- npm start: 사용자가 실제로 접하는 시작 과정, 진행 출력, UI 진입과 정상 결과를 확인한다.
- Operator UI: README에서 설명하는 실제 작업 흐름과 화면을 확인한다.
- 현재 UI evidence와 새 문서용 screenshot: 설명과 렌더링된 제품 상태를 비교한다.
- repository focused tests: documentation/wording 작업이 기존 init 및 Operator behavior를 변경하지 않았는지 확인한다.
- repository-wide text search: 삭제·이동된 문서 참조와 용어 불일치를 확인한다.
