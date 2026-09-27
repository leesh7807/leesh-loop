# 2026-09-27-publish-ui-workflow-hierarchy

## Objective

현재 Operator의 Publish 페이지를 실제 Plan 발행 작업에 맞는 정보 구조와 반응형 배치로 개선한다.

사용자가 Plan을 확인하고, 발행 State를 선택하고, Publish를 실행하고, 그 결과를 확인해 다음 작업으로 이동하는 흐름이 화면 크기와 관계없이 명확하게 유지되도록 한다.

## Intent

현재 Publish 페이지는 Plan textarea, Publish 버튼, Notion Tasks와 Symphony Dashboard 링크, Publisher 출력만 직접 나열하는 최소 UI라서 실제 발행 작업에서 무엇을 먼저 확인하고 어떤 행동을 해야 하는지에 대한 위계가 부족하다.

이 페이지는 범용 관리 화면이나 대시보드가 아니라 Plan 하나를 Notion task로 발행하는 작업 surface다. 정보량이나 장식 요소를 늘리기보다 다음 사용자 행동 순서를 화면 구조의 기준으로 삼는다.

1. 발행할 Plan을 확인한다.
2. 발행 State를 결정한다.
3. Publish한다.
4. 발행 결과를 확인하고 필요한 다음 위치로 이동한다.

첫 UI pass는 의도적으로 색상에 의존하지 않는다. 이는 Publish UI를 영구적인 흑백 디자인으로 고정하려는 결정이 아니다. Typography, spacing, sizing, alignment, grouping, border, responsive layout만으로도 작업 위계와 완성도가 성립하는지를 먼저 검증하기 위한 것이다. 이후 색상을 사용하더라도 이미 성립한 정보 구조와 의미를 보강하는 역할이어야 한다.

UI 리뷰는 단순히 색이 없는지 또는 시각적으로 화려한지를 평가하지 않는다. 색상 없이도 primary action, 정보 우선순위, 입력과 결과의 관계, 성공·실패 이후의 다음 행동이 정확히 드러나는지를 확인한다.

현재 Publisher의 validation, Plan 해석, identifier/title 결정, duplicate 처리, publication State 처리 및 실패 의미는 기존 동작 계약이다. UI 개선 작업은 별도의 validation authority나 publication policy authority가 되거나 기존 Publisher 계약보다 강한 입력 규칙을 새로 만들지 않는다.

## Verification Requirements

- Publish 페이지에서 Plan 입력 또는 확인 → State 선택 → Publish → 결과 확인 순서로 자연스럽게 작업할 수 있고, 시각적 배치와 문서 순서가 이 작업 순서를 방해하지 않는다.
- Plan은 페이지의 주 작업 surface다. Navigation, metadata, 결과 표현 또는 보조 정보가 Plan 입력보다 더 강한 시각적 우선순위를 가져서는 안 된다.
- State 선택과 Publish action은 하나의 publication decision 영역으로 인식되며 navigation과 명확히 구분된다.
- UI의 State 선택지는 Publisher가 사용하는 기존 repository configuration에서 파생된다. UI만의 State 목록이나 별도의 publication policy를 만들지 않고, 현재 Publisher 기본 State 동작을 유지한다.
- 넓은 데스크톱부터 좁은 viewport까지 의미 있는 정보 순서와 작업 흐름을 유지한다. 좁은 화면에서 수평 스크롤이나 잘린 primary action이 없어야 하며, 넓은 화면에서도 작업 영역이 읽기 어려울 정도로 불필요하게 확장되지 않아야 한다.
- 첫 UI pass는 상태별 색상, accent color, gradient, shadow 또는 색상을 통한 hierarchy에 의존하지 않는다. 색상을 제거해도 primary action, secondary navigation, 입력, 결과, 성공과 실패의 의미를 구분할 수 있어야 한다.
- 흑백 구성은 최종 visual identity 결정으로 해석하지 않는다. UI 리뷰에서는 색상 없이도 typography, spacing, sizing, alignment, grouping 및 element placement만으로 작업 위계와 완성도가 만들어졌는지를 판단한다.
- Publish 성공 시 raw CLI 출력이나 내부 식별 정보를 단순 노출하지 않는다. 사용자가 발행 성공 여부와 실제 다음 행동을 이해할 수 있어야 하며, 기존 Publisher가 반환하는 authoritative publication result를 사용한다.
- Publish 실패 시 사용자가 제출하던 Plan과 선택한 publication context를 잃지 않고 실패 원인을 확인한 뒤 다시 작업할 수 있다.
- UI는 기존 Publisher의 validation 또는 publication semantics를 재정의하지 않는다. 새로운 client-side 규칙 때문에 기존 Publisher가 허용하던 입력을 새로 차단하거나 Publisher가 거부하는 상태를 UI만의 판단으로 성공 가능한 것으로 취급하지 않는다.
- Title, Identifier 또는 기타 파생 정보를 표시한다면 Publisher와 다른 독립적인 해석 규칙을 만들지 않는다. authoritative하게 일치시킬 수 없는 파생 정보는 live preview로 강제하지 않는다.
- 기존 Notion Tasks와 Symphony Dashboard 접근 경로를 유지하되 Publish primary task와 경쟁하지 않는 secondary navigation으로 둔다.
- 실제 Publisher 실패가 Publish UI를 통해 발생해도 Plan 보존, publication context 보존, 오류 표시 및 재시도 가능 상태가 유지되는 것을 실제 사용자 경로에서 확인한다.
- PR에는 `docs/ui-evidence/` 아래에 실제 Publish 페이지 렌더링 evidence를 남긴다. 최소한 정상 입력 상태, 성공 결과, 실패 결과, 넓은 viewport, 좁은 viewport에서 요구사항을 판단할 수 있어야 한다.
- UI evidence와 PR 리뷰 문맥에는 첫 pass를 흑백으로 구성한 이유를 명시한다. 리뷰는 색상 취향보다 정보 위계, 작업 흐름, responsive behavior 및 색상 비의존성을 중심으로 한다.
- 기존 Publisher 및 Operator publication behavior는 UI 변경 전후 동일하게 유지한다. UI 구조 개선을 위해 별도의 publication lifecycle이나 새로운 task 속성 편집 책임을 도입하지 않는다.

## Definitions

### Publish 페이지

Operator가 제공하는 Plan 발행용 웹 surface. 현재 `operator/app/leesh-loop.mjs`에서 제공하는 Publish UI다.

### Plan

Publisher에 전달되어 Notion의 canonical Plan/task publication으로 이어지는 Markdown 입력이다.

### Publication decision

사용자가 Plan 내용을 확인한 뒤 실제 발행을 결정하기 위해 선택하는 State와 Publish action이다.

### Primary action

현재 페이지의 핵심 사용자 행동인 `Publish Plan`이다.

### Secondary navigation

Publish 자체가 아니라 관련 작업 surface로 이동하는 Notion Tasks와 Symphony Dashboard navigation이다.

### Authoritative result

Publisher가 실제 publication 경로를 수행한 뒤 반환하는 성공 결과 또는 오류다. UI 자체의 추정 상태는 authoritative result가 아니다.

### Publisher State source

현재 Publisher configuration이 보유하는 State 목록이다. 현재 repository에서는 Publisher configuration의 `state_seeds`가 UI 선택지를 구성할 때 재사용할 기존 State source이며, UI가 별도의 State 목록을 소유하지 않는다.

`state_seeds`를 UI에 사용한다고 해서 Publisher의 기존 State validation 계약을 더 강하게 바꾸지는 않는다. 이 Plan은 UI에서 선택 가능한 값을 기존 configuration과 일치시키는 것만 다룬다.

### UI evidence

실제 Publish 페이지가 요구된 작업 흐름과 responsive layout을 만족하는지 PR에서 검토하도록 `docs/ui-evidence/`에 남기는 렌더링 및 설명 자료다.

### Monochrome first pass

첫 UI pass에서 색상을 hierarchy나 상태 의미의 주요 전달 수단으로 사용하지 않는 접근이다. 최종 UI를 영구적으로 흑백으로 유지한다는 뜻은 아니다.

## Decisions

### 작업 구조

Publish 페이지는 다음 세 책임 영역만 명확히 구분한다.

1. Plan 작업 영역
2. Publication decision 영역
3. Publication result 영역

Navigation은 이 세 영역과 경쟁하지 않는 보조 위치에 둔다. 별도의 dashboard, publication history, task 목록 또는 configuration panel을 추가하지 않는다.

### 정보 위계

Plan이 가장 큰 작업 surface다. State와 Publish action은 Plan 확인 이후 이어지는 하나의 행동군이다. 성공 또는 실패 결과는 방금 수행한 Publish action과 공간적으로 연결한다. Notion Tasks와 Symphony Dashboard는 항상 접근 가능하게 유지하되 primary action보다 약한 위계로 표현한다.

### Plan 영역 크기

Plan 입력 영역은 특정 고정 모니터 크기의 폭이나 높이에 의존하지 않는다. 좁은 viewport에서는 사용 가능한 폭을 활용하고, 넓은 viewport에서는 본문이 읽기와 편집이 어려울 정도로 확장되지 않도록 최대 폭을 제한한다. Plan이 길어져도 primary publication action의 발견 및 접근성을 훼손하지 않는다. 정확한 editor 높이, scrolling 방식 및 CSS 수치는 실제 렌더링을 기준으로 구현자가 결정한다.

### State 선택

State는 사용자가 Publish 시 결정하는 publication input이다. UI는 Publisher configuration의 기존 `state_seeds`를 선택지 source로 사용하고 동일한 State 목록을 UI 내부에 다시 하드코딩하지 않는다. 현재 Publisher의 기본 publication State인 `Ready` 동작을 유지한다. 사용자가 별도의 State를 선택하지 않으면 Publisher의 기존 default와 다른 결과가 생기지 않아야 한다. 이 UI 선택지 구성은 Publisher 자체의 accepted State contract를 재정의하거나 제한하지 않는다.

### 결과 표현

성공 결과는 raw Publisher JSON을 주 UI로 노출하지 않는다. 사용자는 publication 성공 여부, 만들어진 publication result, 실제 Notion 결과로 이동하는 방법, 다른 Plan을 계속 발행하는 방법을 판단할 수 있어야 한다. 내부 `page_id`와 같이 실제 사용자 행동에 필요하지 않은 값은 주요 결과 정보로 승격하지 않는다.

실패 시 기존 Plan과 선택한 State를 보존하고 Publisher가 반환한 실제 오류를 실패한 Publish action과 연결해서 보여준다.

### 파생 정보

Title과 Identifier는 사용자 입력값으로 취급하지 않는다. 화면에 표시할 경우 read-only derived information임을 명확히 한다. UI에서 Publisher와 별도의 title/identifier authority를 구현하지 않는다. 동일 규칙을 신뢰성 있게 공유할 수 없다면 초기 UI의 live derived preview를 생략할 수 있다.

### Validation 경계

현재 Publisher와 Operator가 이미 수행하는 validation과 publication failure가 authority다. UI layout 개선을 이유로 새로운 Plan 형식 요구, H1 requirement, Publisher와 별도의 identifier/title validity 판단, duplicate 판단, State validity contract 또는 기존 publication semantics보다 강한 client-side blocking을 추가하지 않는다.

HTML 자체의 기본 form 동작 또는 이미 존재하는 동일 의미의 제약을 유지할 수 있다. 새로운 behavioral contract가 필요한 경우 이 Plan에 묶지 않고 별도 변경으로 다룬다.

### Monochrome first pass

첫 구현에서는 색상을 hierarchy를 만드는 해결책으로 사용하지 않는다. Typography, font weight, font size, whitespace, section spacing, alignment, width, element sizing, border, source order 및 grouping을 우선 사용한다. 색상을 다시 도입하는 것은 완료 조건이 아니다.

리뷰에서 “색을 추가하면 더 보기 좋다”는 사실만으로 finding을 만들지 않는다. 먼저 색상 없이도 작업 hierarchy가 충분히 성립하는지를 평가한다.

### Responsive layout

특정 모니터 해상도 하나에 맞춘 별도 layout을 만들지 않는다. 가능한 한 intrinsic layout과 제한된 content width를 사용해 viewport 변화에 자연스럽게 대응한다. Desktop과 narrow viewport에서 information order 자체는 바꾸지 않는다. Responsive 동작을 위해 실제로 필요한 경우에만 breakpoint를 사용한다.

### UI evidence

`docs/ui-evidence/` 아래에 Publish UI evidence를 둔다. Publish 페이지 evidence는 하나의 하위 영역으로 정리하며, 파일명은 보여주는 상태와 viewport를 드러낸다.

Evidence는 Plan이 입력된 기본 publication 화면, successful publication result, failed publication result, wide viewport 및 narrow viewport를 리뷰할 수 있게 한다. 정확한 파일 개수나 이름은 evidence 구성이 명확하다면 구현자에게 맡긴다.

Evidence 설명에는 다음 리뷰 의도를 포함한다.

- monochrome은 최종 색상 정책이 아니라 layout/hierarchy 검증 단계다.
- color 없이 primary/secondary hierarchy가 성립하는지 본다.
- 실제 user action order가 시각적 order와 일치하는지 본다.
- wide/narrow viewport에서 동일한 작업 흐름이 유지되는지 본다.
- validation semantics 자체는 이 UI 작업의 변경 대상이 아니다.
- Publisher configuration과 다른 UI-local State policy가 생기지 않았는지 본다.

### Protected scope

다음은 이 Plan에서 변경하지 않는다.

- Publisher의 Plan publication semantics;
- Publisher의 identifier derivation;
- title extraction과 fallback 계약;
- duplicate publication 처리;
- Notion canonical Plan/task representation;
- Publisher의 State validation 및 finalization semantics;
- task Priority, Labels, Blocked By 등의 별도 편집 책임;
- Notion database bootstrap 및 property policy;
- Operator의 lifecycle ownership;
- Symphony Dashboard 동작;
- Notion Tasks 자체의 UI 및 데이터 모델.

UI 개선 과정에서 위 영역을 변경해야 할 실제 필요가 발견되면 해당 변경은 별도 Plan으로 분리한다.

### Naming

새 파일, module, type, major function이 필요하다면 현재 책임을 직접 드러내는 이름을 사용한다. 단순 Publish page rendering, publication result presentation, UI evidence와 같은 현재 책임을 표현하고 아직 존재하지 않는 일반화된 design system, form framework, validation framework 또는 UI platform abstraction을 전제로 이름을 만들지 않는다.

### 작업 단위

#### Publish 작업 흐름 재구성

Plan, State, Publish action, navigation을 실제 사용자 행동 순서와 시각적 위계에 맞게 재배치하고 responsive layout을 구성한다. State 선택지는 기존 Publisher State source와 일치시키고 UI에 별도 State policy를 만들지 않는다. publication을 실행하기 전 화면만으로 이 작업 단위를 독립적으로 판단할 수 있어야 한다.

#### Publication 결과 표현

실제 Publisher 성공 및 실패 결과를 Publish 작업과 연결된 사용자 결과로 표현한다. 성공 시 실제 다음 행동을 제공하고, 실패 시 Plan과 선택한 publication context를 보존하면서 authoritative Publisher error를 확인하고 다시 시도할 수 있게 한다.

#### UI evidence surface

대표 viewport와 publication state를 실제 렌더링으로 남기고 monochrome first pass의 리뷰 의도와 판단 기준을 문서화한다. 이 작업 단위는 production UI behavior를 추가하는 기능이 아니라 PR에서 UI 계약을 검증하기 위한 evidence 책임만 가진다.

## Verification

### 실제 Publish 진입점 확인

Operator를 실제 Publish UI entry point로 실행하고 브라우저에서 페이지를 연다. 초기 화면에서 Plan이 가장 강한 작업 surface인지, State와 Publish action이 Plan 다음의 하나의 행동군인지, Tasks와 Dashboard가 접근 가능하지만 primary action과 경쟁하지 않는지, 색상 없이 hierarchy가 이해되는지 확인한다. UI State 선택지가 Publisher configuration의 현재 State source와 일치하고, 별도 State를 선택하지 않는 기본 경로가 기존 Publisher default인 `Ready`를 유지하는지 확인한다.

### 실제 publication 성공 경로

대표 Plan을 Publish 페이지에 입력하고 실제 지원 State를 선택한 뒤 Publish한다. 실제 Operator Publish endpoint와 Publisher를 통과해 Notion publication이 성공했음을 확인하고 화면 결과와 authoritative Notion 결과를 대조한다.

성공 evidence에서 성공 여부가 명확한지, 선택한 State가 실제 published task에 반영됐는지, raw internal output보다 실제 결과와 다음 행동이 우선하는지, Notion 이동 경로가 실제 published task를 여는지, 새로운 Plan publication으로 이어질 수 있는지, 성공 의미가 색상에 의존하지 않는지 확인한다.

### 실제 publication 실패 경로

기존 Publisher가 실제로 반환하는 재현 가능한 failure path 하나를 실제 Publish UI에서 발생시킨다. 가능하면 별도의 production semantics를 변경하지 않고 안전하게 재현할 수 있는 이미 publication된 동일 Plan의 duplicate publication 같은 경로를 사용한다.

검증 경로는 다음 실제 흐름을 유지한다.

`Publish UI → Operator POST endpoint → Publisher → publication failure → Publish UI failure readback`

실패 evidence에서 사용 중인 Plan과 선택한 State가 보존되고, Publisher의 실제 오류를 확인할 수 있으며, 사용자가 수정하거나 그대로 다시 시도할 수 있는 publication form 상태가 유지되는지 확인한다. 실패와 retry action의 관계가 명확하고 실패 의미가 색상에 의존하지 않아야 한다.

실제 failure path를 수행할 수 없는 환경이면 더 낮은 수준의 테스트로 이 요구사항을 통과 처리하지 않는다. 수행하지 못한 이유와 미검증 범위를 Plan 또는 PR evidence에 명시하고 해당 Verification Requirement가 미충족임을 그대로 남긴다.

### Responsive verification

동일한 Publish 작업 상태를 최소한 wide viewport와 narrow viewport에서 실제 렌더링한다. 정보 순서가 동일하고 좁은 화면에 수평 overflow가 없으며 Plan editor와 Publish action을 사용할 수 있는지, primary action이 잘리거나 별도 보조 surface 뒤로 밀리지 않는지, 넓은 화면에서 작업 영역이 과도하게 퍼지지 않는지, 색상이 없어도 hierarchy가 유지되는지 비교한다.

특정 viewport pixel 값 자체를 contract로 삼지 않고 desktop과 narrow layout에서 요구한 작업 특성이 관찰되는지를 기준으로 한다.

### Existing behavior regression

현재 Operator 및 Publisher의 기존 자동화 테스트를 실행해 UI 구조 변경이 publication behavior를 바꾸지 않았음을 확인한다. 기존 테스트 범위에서 Plan publication, 기본 및 명시적 State 전달, identifier/title 처리, duplicate/incomplete publication handling, publication success/failure 및 Operator Publish endpoint 동작이 그대로 유지되는지 본다.

UI 작업 때문에 기존 테스트의 기대 동작을 새 UI에 맞춰 임의로 약화하지 않는다.

### UI evidence readback

PR 전에 실제 검증에 사용한 UI evidence를 `docs/ui-evidence/`에 저장한다. Evidence만 보고도 사용자가 처음 무엇을 해야 하는지, Plan이 작업 중심으로 보이는지, State와 Publish가 하나의 결정 흐름인지, navigation이 보조 역할인지, 성공 후 다음 행동이 명확한지, 실패 후 Plan과 State를 유지하며 계속할 수 있는지, 작은 화면에서 같은 흐름인지, 색상 없이 위계와 상태 의미가 충분한지, State 선택지가 Publisher configuration과 분기되지 않았는지를 판단할 수 있어야 한다.

Evidence 설명에는 monochrome first pass의 목적을 명시해 이후 chatgpt-shot 리뷰가 색상 추가 여부가 아니라 layout, hierarchy, interaction flow, responsive behavior 및 기존 behavior 경계를 평가하게 한다.

## Verification Tools

- **Operator Publish UI**: 실제 사용자가 접근하는 Publish entry point와 Plan → State → Publish → result 흐름을 검증한다.
- **실제 브라우저 렌더링**: typography, spacing, grouping, viewport 대응, overflow, action visibility를 직접 확인한다.
- **Publisher configuration**: UI State 선택지가 기존 repository State source와 일치하며 별도 State policy가 생기지 않았는지 확인한다.
- **Notion authoritative readback**: 성공한 Publish 결과가 실제 task로 만들어졌는지, 선택한 State가 반영됐는지, UI가 연결하는 결과가 동일한 publication인지 확인한다.
- **실제 duplicate publication 등 기존 Publisher failure path**: UI에서 시작한 실제 실패가 Plan과 State를 보존하는 retry 가능한 화면으로 돌아오는지 확인한다.
- **기존 Operator test suite**: Publish endpoint와 Operator lifecycle 주변 동작의 regression을 확인한다.
- **기존 Notion Publisher test suite**: publication semantics, State, identifier/title 및 실패 처리 계약이 UI 변경으로 변하지 않았는지 확인한다.
- **`docs/ui-evidence/` screenshots 및 설명**: PR의 UI review에서 wide/narrow, success/failure 및 monochrome hierarchy를 반복해서 검토할 evidence를 제공한다.
- **chatgpt-shot PR review**: UI evidence와 Plan의 monochrome first-pass 의도를 함께 제공해 정보 위계, 실제 작업 흐름, responsive behavior, State ownership 및 protected behavior 경계를 중심으로 독립 리뷰한다.
