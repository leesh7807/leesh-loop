# 2026-09-28-operator-attention-hierarchy

## Objective

Operator UI를 실제 운영 중인 여러 task를 빠르게 파악하고, 현재 사람이 봐야 할 작업을 쉽게 발견할 수 있는 화면으로 개선한다.

현재 UI가 가진 명확한 정보 계층과 작업 의미는 유지하면서, 중요한 task를 찾기 위한 스크롤과 탐색 비용을 줄이고 한 화면에서 현재 작업 상황을 더 효과적으로 파악할 수 있게 한다.

이번 결과는 색상에 의존하지 않는 무채색 UI로 만든다.

## Intent

현재 Operator UI는 개별 task를 읽고 이해하기에는 명확하지만, task 수가 늘어나면 각 task가 차지하는 공간 때문에 전체 상황을 훑거나 사람이 확인해야 할 작업을 찾는 데 스크롤이 많이 필요하다.

Operator는 단순히 task 상세를 나열하는 화면이 아니라, 현재 project work의 상황과 사용자가 개입해야 할 지점을 빠르게 파악하는 운영 surface로 본다.

`docs/DESIGN.md`의 관점에 따라 정보와 행동의 의미와 우선순위가 화면 구조 자체에 드러나야 한다. 특히 중요한 항목을 찾기 위해 반복적으로 탐색하거나 스크롤해야 하는 비용을 줄이고, 화면 크기가 달라져도 중요한 대상과 작업 우선순위를 발견할 수 있어야 한다.

모든 task를 동일한 시각적 비중으로 완전하게 보여주는 것보다 실제 사용에서 필요한 scanability와 attention을 우선할 수 있다. 세부 정보의 즉시 가시성이나 현재 카드의 여유로운 공간은 이 목적을 위해 필요한 만큼 양보할 수 있다.

현재 UI는 문제를 이해하고 개선 방향을 판단하기 위한 baseline으로 사용한다. 이번 작업의 완료 여부를 현재 UI와의 정량적 또는 영구적인 전후 비교 자체로 판단하지 않고, 최종 결과가 운영 surface로서 요구되는 attention, scanability, hierarchy를 실제로 만족하는지로 판단한다.

특정 카드, table, 별도 attention section, disclosure 방식 등 구체적인 표현 형태를 미리 정답으로 고정하지 않는다. 실제 UI 구조는 이 의도와 `docs/DESIGN.md`의 기준을 가장 단순하게 만족하는 형태로 정한다.

## Verification Requirements

- 현재 사람이 확인해야 할 task가 일반 task 사이에 묻히지 않아야 한다. `Human Review`는 가장 높은 attention을 가져야 하며, `Merging`과 `In Progress`도 일반적인 대기·완료 성격의 task보다 먼저 발견할 수 있어야 한다.
- 여러 task가 존재하는 실제 운영 상황에서 사용자가 전체 목록을 순차적으로 읽거나 긴 스크롤을 먼저 하지 않아도 현재 중요한 작업과 진행 상황을 파악할 수 있어야 한다.
- task 수가 늘어나도 task surface가 단순한 상세 카드의 연속으로 인해 과도하게 길어지지 않아야 하며, 한 화면에서 현재 작업 구성을 의미 있게 파악할 수 있어야 한다. 이를 위해 secondary detail의 기본 노출량은 줄일 수 있지만 task의 핵심 의미와 필요한 접근 경로를 잃어서는 안 된다.
- `Title`, `State`와 현재 작업 판단에 필요한 관계가 명확한 hierarchy를 유지해야 한다. 기존 task 상세, canonical task/Plan navigation 및 publication 기능은 필요한 때 계속 접근 가능해야 한다.
- UI가 별도의 lifecycle 또는 priority policy를 만들지 않아야 한다. State와 canonical task/Plan data의 의미 및 authority는 기존 Notion/Publisher 계약을 그대로 사용한다. 화면상 attention은 표시와 탐색을 위한 관점이며 State 의미 자체를 변경하지 않는다.
- 기존 Operator task read/refresh, publication, failure preservation, secondary navigation 및 configured base에서 제공되는 task/publication 기능을 회귀시키지 않아야 한다.
- wide와 narrow viewport 모두에서 동일한 정보 우선순위와 작업 의미가 유지되어야 하며, 작은 화면에서도 중요한 task를 발견하기 위해 불필요한 탐색 비용이 생기지 않아야 한다.
- 최종 UI는 무채색으로 구성하고, 색상이 없어도 중요도, grouping, primary/secondary 관계, task State와 사용자가 취할 다음 행동을 이해할 수 있어야 한다.
- 최종 UI의 실제 browser rendering을 스크린샷으로 repository에 커밋해, 코드만 보지 않고 결과 화면 자체를 독립적으로 검토할 수 있어야 한다. evidence에는 실제 사용 밀도와 attention hierarchy를 판단할 수 있는 wide/narrow 화면이 포함되어야 한다.
- 커밋된 UI evidence를 대상으로 `docs/DESIGN.md` 관점의 chatgpt-shot 독립 UI review를 수행할 수 있어야 한다. 리뷰 대상은 구현 방식의 취향이 아니라 중요한 항목의 발견 가능성, 실제 작업과 hierarchy의 일치, scan cost, 화면 크기에 따른 의미 보존, 무채색 상태에서의 구조적 명확성이다.

## Definitions

- **Attention**: 사용자가 현재 확인하거나 판단할 필요가 있어 화면에서 먼저 발견되어야 하는 정도. task lifecycle 자체의 우선순위나 새로운 canonical field를 의미하지 않는다.
- **Scanability**: 여러 task가 있는 상태에서 각 task의 상세를 순차적으로 읽지 않고도 중요한 상태와 현재 작업 구성을 빠르게 파악할 수 있는 정도.
- **Primary task information**: 현재 어떤 task인지와 사용자가 지금 관심을 가져야 하는지를 판단하는 데 직접 필요한 정보.
- **Secondary detail**: task 이해에는 유용하지만 전체 상황을 훑는 순간마다 항상 노출될 필요는 없는 정보.
- **UI evidence**: 최종 구현의 실제 browser rendering을 repository에 커밋한 스크린샷. mockup이나 구현 전 설계안은 최종 evidence로 보지 않는다.

## Decisions

- `docs/DESIGN.md`를 이번 UI 변경의 디자인 기준으로 사용한다. 별도의 시각 철학이나 component catalog를 새로 만들지 않는다.
- attention hierarchy에서는 `Human Review`를 가장 먼저 발견할 수 있게 한다. `Merging`과 `In Progress` 역시 낮은 attention의 task보다 우선해서 발견할 수 있게 하되, 이 관계를 새로운 lifecycle 의미로 만들지 않는다.
- 시간적 순서는 여전히 유용한 보조 정보로 취급한다. 다만 시간순만으로 중요한 task가 아래로 밀리는 구조를 유지하지 않는다. attention이 같은 task 사이의 세부 ordering 방식은 기존 authoritative data와 UI의 단순성을 기준으로 구현에 맡긴다.
- density 개선은 단순히 typography나 spacing을 작게 만드는 것으로 한정하지 않는다. primary information과 secondary detail의 노출 비중을 다시 판단할 수 있다.
- task 상세를 읽기 쉬운 현재 UI의 장점보다 전체 운영 상황을 빠르게 파악하는 목적이 우선하는 경우, 카드의 크기나 항상 펼쳐져 있는 세부 정보는 축소할 수 있다.
- 색상은 이번 변경에서 hierarchy나 State 구분 수단으로 사용하지 않는다. typography, spacing, sizing, alignment, grouping, boundary, placement 등 구조적 수단으로 의미가 성립하도록 한다.
- 현재 UI와의 전후 비교는 구현 방향을 확인하는 작업 중 판단 수단으로 사용할 수 있지만, baseline screenshot의 영구 보존이나 수치 KPI를 최종 delivery contract로 만들지 않는다.
- UI evidence는 최종 결과를 대표하는 최소 세트만 유지한다. 현재 `docs/ui-evidence/operator-task-ui/`에 남아 있는 이전 UI 스크린샷은 새 결과로 대체되면 삭제해도 되며, 기존 evidence 설명용 `README.md`도 유지할 필요가 없다. evidence를 설명하기 위한 별도 문서 구조를 새로 만들 필요도 없다.
- 최종 screenshot 파일명은 무엇을 검토하는 화면인지 repository에서 바로 알 수 있게 한다. 단순 cycle 번호나 구현 세부 이름을 중심으로 명명하지 않는다.
- **Protected scope:** Notion의 canonical task/Plan authority, Publisher의 publication authority와 State policy, task/Plan navigation, Operator server-side Notion boundary, polling/refresh failure semantics, publication success/failure semantics, Symphony Dashboard의 runtime observability 책임은 이번 변경에서 재설계하지 않는다. 이 경계를 넘어서는 변경은 별도 계획으로 미룬다.
- **Naming:** 새 file, module, type 또는 주요 function이 필요하면 현재 맡은 UI responsibility와 역할이 이름에서 드러나야 한다. 아직 존재하지 않는 generic design-system, priority-engine, attention-policy 같은 추상화를 전제로 이름이나 구조를 만들지 않는다.

## Verification

1. 변경 전 Operator UI를 실제 운영 workload 또는 그 문제를 충분히 드러내는 동등한 workload에서 확인한다.

   이 단계의 목적은 baseline을 최종 성공 조건으로 증명하는 것이 아니라, 현재 카드 구조에서 density와 attention 발견 비용이 어떤 식으로 나타나는지 구현자가 직접 확인하고 그 문제를 놓치지 않게 하는 것이다.

2. 최종 Operator UI에서 여러 State의 task가 함께 존재하는 실제 사용 상황을 확인한다.

   사용자가 전체 목록을 처음부터 끝까지 읽거나 긴 스크롤을 먼저 하지 않아도 `Human Review`를 비롯한 중요한 task와 현재 진행 상황을 파악할 수 있어야 한다.

   task가 여러 개 존재해도 화면이 개별 상세를 순차적으로 읽는 용도로만 구성되지 않고, 현재 project work를 훑는 운영 surface로 기능하는지 확인한다.

3. 최종 UI를 wide와 narrow viewport에서 실제 사용 관점으로 검토한다.

   화면 크기가 달라져도 `Human Review`를 비롯한 중요한 task가 먼저 발견되고, `Merging`과 `In Progress`가 일반 task에 묻히지 않으며, primary information과 secondary detail의 상대적 의미가 유지되는지 확인한다.

   좁은 화면에서도 hierarchy가 단순히 긴 세로 목록으로 퇴행하거나 필수 작업이 수평 overflow로 손실되지 않아야 한다.

4. 최종 화면을 무채색 상태 그대로 `docs/DESIGN.md` 기준으로 검토한다.

   색상 없이도 무엇이 중요한지, task들이 어떻게 묶이고 구분되는지, primary와 secondary 정보가 무엇인지, 현재 State와 다음 행동이 무엇인지 자연스럽게 이해할 수 있어야 한다.

5. 기존 Operator 기능이 UI 재구성 뒤에도 그대로 이어지는지 확인한다.

   representative task에서 task/Accepted Plan navigation, 필요한 secondary detail, publication controls 및 refresh 상태에 접근할 수 있어야 한다. publication과 refresh의 기존 interaction path가 연결되어 있고, failure context를 표현하고 보존하는 UI 의미가 사라지지 않았음을 확인한다.

   Publisher의 실제 success/failure semantics와 task read/refresh 계약 자체는 직접 관련 test suite로 확인하며, 이번 UI 검증을 위해 별도의 운영 실패를 인위적으로 만들지 않는다.

6. 최종 UI 변경이 끝난 상태에서 실제 browser rendering의 wide/narrow 스크린샷을 `docs/ui-evidence/operator-task-ui/` 아래 생성하고 커밋한다.

   screenshot은 단순히 화면이 렌더링된다는 증거가 아니라, task density, attention hierarchy, primary/secondary 관계와 responsive 의미 보존을 실제로 판단할 수 있는 상태를 담아야 한다.

   screenshot 생성 후 layout, styling, information hierarchy 등 rendering에 영향을 주는 UI 변경이 있었다면 evidence를 다시 생성한다. chatgpt-shot UI review는 최종 review 대상 PR/HEAD의 UI implementation에서 생성된 최신 evidence를 사용한다.

   새 evidence로 대체된 기존 screenshot과 기존 `README.md`는 제거할 수 있다.

7. 커밋된 screenshot과 `docs/DESIGN.md`를 함께 제공해 chatgpt-shot으로 독립 UI review를 수행한다.

   review는 특정 layout이나 미적 취향을 정답으로 요구하지 않고, 다음 관점에서 최종 화면이 이번 계획의 의도를 실제로 달성하는지 판단한다.

   - 중요한 것이 먼저 발견되는가
   - 실제 운영 작업과 화면 hierarchy가 맞는가
   - task가 많아져도 scan과 탐색 비용이 과도하지 않은가
   - primary information과 secondary detail이 경쟁하지 않는가
   - wide/narrow에서 동일한 작업 의미가 유지되는가
   - 색상 없이도 구조와 우선순위가 성립하는가

   finding은 실제 화면에서 이 목적을 방해하는 구체적인 문제에 한정한다.

8. 기존 Operator UI와 Notion Publisher의 직접 관련 test suite를 실행해 task read/refresh, publication success/failure와 failure preservation, authoritative navigation 및 기존 authority boundary가 회귀하지 않았는지 확인한다.

PR을 만들기 전 이 Plan을 `docs/plans/completed/`로 이동한다. 최종 PR/HEAD readback에서는 UI implementation과 screenshot evidence가 함께 포함되어 있는 것뿐 아니라, review에 사용한 screenshot이 그 PR/HEAD의 최종 rendering을 반영하는 evidence인지 확인한다.

## Verification Tools

- **변경 전 Operator browser surface**: 현재 UI에서 density와 attention 문제가 실제로 어떤 형태로 나타나는지 구현 방향을 확인한다.
- **최종 Operator browser surface**: attention hierarchy, scanability, task density, navigation 및 responsive 결과가 운영 UI로서 충분한지 확인한다.
- **Browser viewport / developer inspection**: wide/narrow rendering, overflow, 실제 노출 정보와 interaction을 확인한다.
- **`docs/ui-evidence/operator-task-ui/` screenshots**: 최종 UI의 실제 hierarchy, density와 responsive 결과를 PR/HEAD에 고정해 독립적으로 검토할 수 있게 한다.
- **chatgpt-shot**: 커밋된 screenshot과 `docs/DESIGN.md`를 기준으로 결과 화면이 의도한 작업 구조와 attention을 전달하는지 독립 검토한다.
- **Operator / Notion Publisher focused test suites**: UI 재구성으로 기존 read, refresh, publication 및 authority boundary가 회귀하지 않았는지 확인한다.
- **Git diff / PR HEAD readback**: 최종 UI code, 완료된 Plan, 현재 screenshot evidence가 동일한 전달 HEAD에 포함되고 서로 같은 최종 rendering을 가리키는지 확인한다.
