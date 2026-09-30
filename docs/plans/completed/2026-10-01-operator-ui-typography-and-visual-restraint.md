# 2026-10-01-operator-ui-typography-and-visual-restraint

## Objective

Operator UI가 현재 작업의 중요도와 상태를 빠르게 읽고 다음 행동으로 이어가기 쉬운 화면이 되도록 시각적 위계를 정리한다.

기존의 Human Review 및 진행 중 작업 우선순위와 Blocked By 기능은 유지하면서, 불필요한 시각적 요소가 작업 정보와 경쟁하지 않는 더 절제된 표현으로 개선한다.

`docs/DESIGN.md`는 이번 UI 수정에서 확인된 문제를 그대로 기록하는 문서로 사용하지 않는다. 이번 작업에서 재확인된 원칙 중 앞으로 다른 UI에도 적용할 수 있고 기존 design philosophy를 실제로 확장하는 내용만 선별하여 반영한다.

현재 화면에 대한 구체적인 미적 선호, 반복 사용을 피하고 싶은 특정 표현 패턴, 이번 구현에서 제거할 안티패턴은 이 계획과 UI 결과에서 다루며, 일반화할 충분한 근거가 없는 내용을 `docs/DESIGN.md`의 영구 규칙으로 승격하지 않는다.

최종 UI 결과는 repository의 `docs/ui-evidence/`에 wide/narrow screenshot evidence로 남겨, 코드와 문서만이 아니라 실제 렌더링 결과를 함께 리뷰할 수 있게 한다. 기존 evidence는 현재 결과와 혼동되지 않도록 정리한다.

## Intent

현재 Operator UI는 Human Review와 진행 중 작업을 상위에 두고 Blocked By 기능을 추가하는 과정에서, 중요도를 표현하기 위한 box, border, left-side accent, boxed metadata가 반복적으로 늘어났다.

그 결과 하나의 중요도를 ordering, grouping, border thickness, left-side accent, boxed state 등 여러 수단으로 중복 표현하고 있으며, 단순 정보와 실제 interactive surface 사이의 시각적 구분도 약해졌다.

특히 bordered rectangle이 정보 grouping과 강조의 기본 수단처럼 반복되면서 화면이 필요 이상으로 장식되어 보이고, 일부 box는 그 자체가 clickable하거나 독립된 control처럼 인식될 여지가 있다.

굵은 left-side accent 또는 rail을 중요도 표시로 반복 사용하는 표현은 현재 Operator UI에서 선호하지 않는다. 반복적인 card/box 강조 역시 현재 화면의 미감과 사용성에 맞지 않는다고 본다. 다만 이러한 구체적 선호를 곧바로 전체 제품의 보편적 디자인 금지 규칙으로 일반화하지 않는다.

이번 작업에서는 두 층위를 구분한다.

첫째, **이번 Operator UI에 적용할 구체적인 디자인 압력**이다. 반복적인 box, left-side accent rail, redundant emphasis, 평상시 task reading과 경쟁하는 Blocked By control 등을 현재 문제로 보고 적극적으로 정리한다.

둘째, **`docs/DESIGN.md`에 남길 장기 원칙**이다. 여기에는 특정 CSS 패턴의 금지나 개인 취향을 직접 기록하기보다, 현재 문제에서 추출할 수 있는 더 일반적인 원칙만 반영한다. 특히 typography가 hierarchy를 담당하는 중요한 수단이라는 점, visual boundary가 실제 구조적 또는 interactive 의미를 가져야 한다는 점, monochrome이 색을 더 많은 border나 box로 대체하는 방식이 되어서는 안 된다는 점, 같은 의미를 여러 강조 수단으로 중복 전달하지 않는다는 점을 후보로 본다.

`docs/DESIGN.md`의 기존 중심은 유지한다. 즉 디자인은 장식 규칙의 집합이 아니라 사용자가 중요한 정보를 발견하고 현재 상태를 이해하며 다음 작업으로 이어가기 쉽게 만드는 문제로 본다. 새 문구도 이 관점을 강화해야 하며 별도의 스타일 가이드나 취향 목록으로 변질시키지 않는다.

Typography는 현재보다 적극적인 위계 수단으로 사용한다. 특정 외부 폰트나 설치된 특정 글꼴에 의존하지 않고 일반적인 system font fallback만으로도 primary work, State와 identifier 같은 operational metadata, supporting context의 성격 차이를 드러낼 수 있어야 한다.

현재의 monochrome 방향은 유지한다. 다만 monochrome을 색 대신 border와 box를 많이 사용하는 제약으로 해석하지 않는다.

디자인 자체를 독립적인 목표로 과도하게 키우지 않는다. 기존 `docs/DESIGN.md`의 중심 원칙인 실제 사용 편의, attention 보호, 자연스러운 continuation을 기준으로 현재 문제를 해결한다.

시각적 결과는 source code만 보고 판단하지 않는다. 실제 wide/narrow screenshot을 리뷰 입력으로 사용하여, 의도한 hierarchy와 restraint가 렌더링 결과에서도 성립하는지 확인한다. 과거 screenshot이 현재 결과처럼 보이거나 리뷰 시 혼동을 만드는 상태도 피한다.

## Verification Requirements

- 사용자가 task surface를 볼 때 task의 제목, 현재 State, 중요한 작업의 우선순위를 이전보다 적은 시각적 해석 비용으로 파악할 수 있어야 한다.
- Human Review와 진행 중 작업이 우선적으로 발견되는 현재의 의미와 우선순위는 유지되어야 한다. 같은 중요도를 여러 장식적 처리로 반복해서 강조할 필요는 없다.
- Blocked By의 기존 기능은 유지되어야 한다. 사용자는 기존 relation을 이해할 수 있고, 새 Plan publication에 blocker를 선택할 수 있으며, 선택한 blocker를 publication 전에 확인할 수 있어야 한다.
- Blocked By interaction과 supporting metadata가 평상시 task inspection의 primary information과 불필요하게 경쟁하지 않아야 한다.
- 일반적인 정보 항목이나 grouping을 구별하거나 중요하게 보이게 한다는 이유만으로 bordered rectangle을 기본 표현 수단으로 사용하지 않아야 한다. 보이는 container boundary는 구조적 또는 interactive 의미와 일치해야 한다.
- task priority 또는 State hierarchy를 표현하기 위한 굵은 left-side accent bar/rail을 사용하지 않아야 한다.
- 하나의 중요도 또는 상태를 ordering, typography, grouping, borders, labels 등의 여러 수단으로 불필요하게 중복 강조하지 않아야 한다.
- typography가 실제 hierarchy를 담당해야 한다. font family, size, weight, case, spacing, alignment 등을 이용해 primary task content, operational metadata, supporting context가 구별되어야 한다.
- typography는 외부 font 다운로드나 특정 시스템에만 설치된 폰트를 필수 조건으로 하지 않아야 한다. 일반적인 `system-ui`, `ui-monospace`, `ui-serif` 계열과 그 fallback만으로 hierarchy와 readability가 유지되어야 한다.
- monochrome 상태에서도 primary/secondary 정보, current State, publication action과 supporting context를 구별할 수 있어야 한다.
- wide와 narrow viewport 모두에서 같은 정보 우선순위와 interaction 의미가 유지되어야 하며, 좁은 화면에서 border나 box를 추가하는 방식으로 hierarchy를 보완해서는 안 된다.
- 기존 task refresh, task navigation, Plan publication, State selection, Blocked By selection/removal, publication result 및 관련 Notion/Plan link 동작은 시각적 정리 때문에 퇴행하지 않아야 한다.
- `docs/DESIGN.md` 변경은 현재 Operator UI의 취향이나 구현 세부를 영구 규칙으로 옮기지 않아야 한다. 추가 문구는 user-work 중심 철학에서 일반화할 수 있어야 하며, typography의 역할, 의미 있는 visual boundary, redundant emphasis와 monochrome restraint에 대한 판단 기준을 명확히 해야 한다.
- `docs/DESIGN.md`는 특정 component, CSS property, 현재 task State 이름, 현재 Operator layout을 전제로 하지 않아야 한다.
- 최종 UI evidence는 `docs/ui-evidence/`에 wide와 narrow viewport 각각 남아 있어야 하며, authoritative current evidence가 무엇인지 바로 식별할 수 있어야 한다.
- 과거 Operator UI screenshot이 현재 결과와 혼동되지 않아야 한다. current evidence와 historical evidence를 같이 둘 필요가 없다면 현재 review에 필요한 evidence만 남긴다.
- 최종 screenshot은 box 수 감소만이 아니라, restraint 상태에서도 중요도와 task context가 명확하게 읽힘을 판단할 수 있어야 한다.

## Definitions

- **Primary task information**: 현재 project work를 훑을 때 우선 확인해야 하는 task title과 current State 등 핵심 정보.
- **Operational metadata**: Identifier, State token, count, timestamp 등 일반 prose와 성격이 다른 짧은 운영 정보.
- **Supporting context**: Blocked By relation, Priority, Labels, Plan/Notion navigation 등 primary task information을 보조하는 정보.
- **Visual boundary**: border, boxed container, panel edge 등 화면에서 하나의 영역을 독립된 단위로 인식하게 하는 경계.
- **Semantic boundary**: 독립된 interaction, form, result, 또는 별도 surface로 이해할 이유가 있는 정보 구조의 경계.
- **Redundant emphasis**: 동일한 중요도나 의미를 여러 시각 수단으로 반복해서 전달하지만 추가 정보는 제공하지 않는 표현.
- **Left-side accent rail**: 중요도나 상태를 나타내기 위해 row 또는 section 왼쪽 가장자리에 굵은 세로 border/bar를 두는 표현.
- **Durable design principle**: 특정 화면이나 개인 취향에만 의존하지 않고 `docs/DESIGN.md`의 기존 철학과 함께 향후 다른 UI 판단에도 재사용할 수 있는 일반 원칙.
- **Local design preference**: 현재 Operator UI의 미감과 경험 판단에 중요하지만, 별도 근거 없이 전체 제품의 보편 규칙으로 승격할 필요가 없는 구체적인 표현 선호.
- **Current UI evidence**: 이번 변경의 최종 렌더링 상태를 보여 주며 현재 review에 직접 사용되는 `docs/ui-evidence/`의 wide/narrow screenshot.
- **Historical UI evidence**: 이전 구현 상태를 보여 주지만 현재 UI의 승인 evidence로 사용되지 않는 과거 screenshot.

## Decisions

- `docs/DESIGN.md` 업데이트와 Operator UI 개선은 함께 진행하되, UI에서 발견된 모든 문제를 DESIGN 문서에 옮기지 않는다.
- DESIGN 변경은 이번 UI 개선 과정에서 확인된 durable design principle만 선별한다. 기존 방향인 user work 반영, visible importance, attention 보호, continuation, authority 보존, use-based judgment는 유지한다.
- DESIGN 문서에는 현재 화면의 취향성 금지 목록이나 특정 구현 세부를 추가하지 않는다. 일반 원칙은 typography가 hierarchy를 만든다는 점, visible boundary가 실제 structural/interactive meaning과 대응해야 한다는 점, monochrome이 색을 additional borders, boxes, decorative separators로 치환하는 방식이 아니라는 점, 같은 중요도를 불필요하게 중복 강조하지 않는다는 점이다.
- 구체적인 typography 조합, row 구조, interaction mode를 문서가 요구하는 것처럼 작성하지 않는다. 현재 화면 문제인 반복 box와 굵은 left-side rail은 구현 판단에서 다룬다.
- Typography는 일반적인 system fallback으로 해결한다. 외부 font service/download나 새 font asset은 범위에 포함하지 않는다. Sans/mono 및 필요한 경우 serif generic family를 역할 구분에 도움되는 범위에서만 쓴다.
- Human Review와 active State의 기존 ordering 의미는 보존한다. `operator-task-display-order.js`의 State ordering은 바꾸지 않는다.
- Blocked By relation과 publication input의 product behavior, Publisher/Notion authority, polling 및 failure semantics는 보호한다. 표현은 정리할 수 있지만 계약은 변경하지 않는다.
- task title, State, Blocked By와 supporting metadata의 노출 수준과 배치는 실제 scanability에 따라 정한다. 새 widget이나 interaction mechanism을 미리 고정하지 않는다.
- 모든 box 제거를 목표로 하지 않는다. textarea, select, button, 독립 form/result처럼 경계가 의미 있는 곳은 유지할 수 있다. box를 whitespace, alignment, typography, horizontal rule 등 다른 장식의 남발로 대체하지 않는다.
- `docs/ui-evidence/`에는 wide/narrow current screenshot을 남긴다. 기존 screenshot은 혼란을 유발하면 삭제하거나 historical evidence로 분명히 분리하고, 같은 surface의 중복 screenshot을 누적하지 않는다. 파일명에는 wide/narrow와 Operator surface가 드러나야 한다.
- `operator/ui`의 역할/API boundary는 유지한다. Publisher, task reader, Notion schema, Symphony 책임을 이동하지 않는다. 범용 component library, token system, typography framework 또는 design system은 만들지 않는다.

## Verification

1. 변경 전 UI와 evidence를 확인하여 Human Review/active emphasis, task row, State, Blocked By, publication surface 및 obsolete screenshot을 파악한다.
2. 실제 wide viewport에서 Human Review와 진행 중 작업이 먼저 발견되고, title/State가 자연스럽게 읽히며, 중복 강조·굵은 left rail이 없고, 정보 grouping과 실제 controls가 구별되는지 확인한다.
3. narrow viewport에서 같은 정보 순서와 의미가 유지되며 새 box/decorative boundary가 추가되지 않고 title, State, supporting context, publication interaction이 읽히는지 확인한다.
4. 실제 렌더링의 typography가 primary content와 operational metadata를 구별하며 system fallback만으로 성립하는지 확인한다.
5. 실제 UI에서 기존 Blocked By relation을 확인하고, publication용 blocker 추가/선택 확인/제거 및 blocker 없는 기존 publication 경로를 확인한다. 이 interaction이 상시 task inspection과 경쟁하지 않는지도 본다.
6. Operator UI에서 Plan, optional Blocked By, State로 실제 publication을 실행해 success result/navigation을 확인하고 가능한 경우 Notion authoritative readback으로 State와 Blocked By relation을 확인한다. Publisher authority는 변경하지 않는다.
7. 기존 UI automated tests(task ordering, blocker draft/selection)와 production UI build를 실행한다. Presentation assertion 변경이 필요하면 새 presentation contract에 맞추되 product behavior assertion은 약화하지 않는다.
8. `docs/ui-evidence/`를 정리하고 최종 wide/narrow screenshot을 갱신한다. screenshots는 primary hierarchy, State, Blocked By context와 publication surface를 리뷰하기에 충분해야 한다.
9. screenshot을 실제 review 입력으로 삼아 ordering, restraint, Blocked By prominence, monochrome/system typography, narrow behavior를 확인한다. box count 감소만으로 통과시키지 않는다.
10. `docs/DESIGN.md` 문구가 durable하고 다른 UI에도 의미가 통하는지 검토한다. 특정 취향, 구현 세부, 금지 목록은 제외하고 기존 user-work 철학을 강화한다.

대표 browser UI 검증이나 authoritative publication readback을 실행할 수 없다면 통과한 것으로 대체하지 않는다. 가장 가까운 evidence, 불가능한 경로와 남은 위험을 정확히 보고한다. screenshot을 만들 수 없는 환경이면 evidence 요구는 미완료로 보고한다.

최종 UI evidence는 코드와 `docs/DESIGN.md` diff와 함께 리뷰한다. PR 전 이 Repository Plan을 `docs/plans/active/`에서 `docs/plans/completed/`로 이동한다.

## Verification Tools

- 실제 Operator UI browser surface: wide/narrow layout, typography, boundaries, Blocked By interaction, responsive behavior.
- Browser screenshots 및 `docs/ui-evidence/`: authoritative current visual evidence.
- UI automated tests 및 production build: ordering, blocker selection/draft, rendering contract, Vite artifact.
- Operator server/Publisher: Plan, State, optional Blocked By의 기존 publication authority.
- 가능한 환경의 Notion authoritative readback: 실제 canonical State와 Blocked By relation.
- Repository diff 및 `docs/DESIGN.md` readback: durable principle과 local preference의 경계.
