# 2026-10-04-operator-ui-navigation-and-accent

## Objective

Operator UI에서 현재 Project와 작업으로 이동하는 경로를 더 자연스럽게 제공하고, 의미가 중복되거나 시각적으로 불필요한 표현을 정리하여 화면의 위계와 사용 흐름을 개선한다.

현재의 절제된 무채색 기반은 유지하되, 하나의 저채도 파란 계열 accent를 제한적으로 추가하여 주요 interaction과 navigation을 더 쉽게 인식할 수 있게 한다.

최종 UI 결과는 repository의 `docs/ui-evidence/`에 wide/narrow rendered evidence로 남겨, 이후 리뷰가 구현 의도나 source code만이 아니라 실제 사용자에게 보이는 결과를 직접 판단할 수 있게 한다.

## Intent

현재 Operator UI는 task의 중요도와 작업 흐름을 typography와 배치 중심으로 드러내도록 정리되어 있지만, Project 자체의 GitHub repository로 이동할 경로가 화면에 없고 일부 heading, label, navigation, supporting text는 같은 의미를 반복하고 있다.

이번 작업은 기능을 더 많이 노출하기보다 사용자가 현재 Project를 이해하고, task를 읽고, 필요한 외부 surface로 이동하고, 다음 행동을 선택하는 흐름을 더 단순하고 자연스럽게 만드는 데 초점을 둔다.

색상은 새로운 hierarchy를 만들어내는 수단이 아니라 이미 구조적으로 드러나는 interactive 의미를 보조하는 수단으로 사용한다. 기존 monochrome 기반을 버리거나 State별 색상 체계를 만드는 방향은 의도하지 않는다.

Pull Request로 직접 이동하는 UX는 유용하지만, 없는 PR을 추론하거나 별도의 사실을 만드는 방식은 사용하지 않는다. 현재 repository 구조에는 Operator task와 Workpad의 PR 정보를 authoritative하게 결합하여 제공하는 경로가 없으므로, 이번 작업에서는 이를 위해 새 runtime/data ownership을 추가하지 않는다.

UI 변경의 성공 여부는 source code나 CSS 값만으로 판단하지 않는다. 실제 렌더링된 wide/narrow 결과를 repository evidence로 남기고, 해당 evidence를 독립적인 UI review의 primary input으로 사용할 수 있는 상태를 만든다.

## Verification Requirements

- Operator 화면에서 현재 Project의 configured GitHub repository를 직접 열 수 있어야 한다.
- GitHub repository 링크는 Operator가 이미 사용하는 Project configuration의 repository identity를 기준으로 해야 하며 별도의 repository identity를 만들거나 추론하지 않아야 한다.
- 현재 task와 authoritative PR URL을 연결할 수 없는 경우 PR link, disabled placeholder, 예상 PR link 등 존재하지 않는 navigation을 표시하지 않아야 한다.
- 화면에서 같은 의미를 반복하는 heading, label, explanatory copy, navigation이 정리되어야 하며, 제거 후에도 각 정보와 action의 의미를 자연스럽게 이해할 수 있어야 한다.
- task title, current State, Human Review와 active work의 우선순위 및 publication action이 계속 주요 정보로 인식되어야 한다.
- Notion task, Accepted Plan, Symphony Dashboard 등 현재 제공되는 유효한 navigation은 의미가 있는 위치에서 계속 접근 가능해야 한다.
- supporting navigation이나 metadata가 primary task information보다 강한 시각적 주의를 요구하지 않아야 한다.
- 기존 무채색 기반에 하나의 저채도 파란 계열 accent만 추가해야 하며, 여러 accent hue나 State별 color coding으로 확장하지 않아야 한다.
- accent를 제거한 상태에서도 정보 hierarchy와 interaction의 의미를 이해할 수 있어야 한다. 색상만으로 중요한 State, grouping 또는 action을 구별하게 만들어서는 안 된다.
- accent는 실제 interaction이나 continuation을 보조해야 하며, 장식적인 영역 구분이나 반복적인 강조를 위해 사용하지 않아야 한다.
- wide와 narrow viewport에서 동일한 navigation, 정보 우선순위와 작업 의미가 유지되어야 한다.
- 기존 task polling과 refresh failure semantics, Human Review/active task ordering, Blocked By 조회 및 publication selection, Plan publication, State selection, publication result, Notion/Plan navigation은 UI 정리로 인해 퇴행하지 않아야 한다.
- 최종 wide/narrow rendered evidence에서 의미 중복의 감소, navigation의 발견 가능성, accent의 절제된 사용, 전체 화면의 시각적 일관성을 실제 결과로 판단할 수 있어야 한다.
- 최종 UI의 authoritative wide/narrow screenshots는 repository의 `docs/ui-evidence/`에 포함되어야 한다.
- repository에 남긴 UI evidence만으로 reviewer가 실제 rendered result의 visual hierarchy, composition, balance, density, spacing, typography, grouping, affordance, scanability, responsiveness 및 overall coherence를 판단할 수 있어야 한다.
- UI review는 repository에 남긴 current screenshots를 primary visual evidence로 사용할 수 있어야 하며, source code나 design rationale만으로 실제 UI 결과를 대신 판단할 필요가 없어야 한다.
- 이전 UI 상태의 screenshots가 현재 결과로 오인되지 않아야 한다. current evidence와 historical evidence를 모두 유지할 필요가 없다면 현재 리뷰에 필요한 authoritative evidence만 남긴다.

## Definitions

- **Project repository**: 현재 Project configuration의 `github_repository_url`이 가리키는 GitHub repository.
- **Project navigation**: Operator에서 현재 Project와 관련된 외부 surface로 이동하는 링크. GitHub repository, Notion Tasks, Symphony Dashboard 등이 포함된다.
- **Task navigation**: 특정 task에 귀속되는 Notion task, Accepted Plan 등 task-level navigation.
- **PR navigation**: 특정 task의 실제 Pull Request로 이동하는 navigation. authoritative PR identity가 있을 때만 성립한다.
- **Accent**: 기존 neutral palette 외에 추가하는 하나의 저채도 파란 계열 색상.
- **Semantic duplication**: 서로 다른 표현이 추가적인 정보나 행동 차이를 제공하지 않으면서 동일한 의미를 반복하는 상태.
- **Primary task information**: task를 훑을 때 우선 확인해야 하는 title, current State 및 현재 작업 우선순위.
- **Supporting information**: identifier, Priority, Labels, Blocked By context, timestamps 및 외부 navigation처럼 primary task 판단을 보조하는 정보.
- **Current UI evidence**: 이번 변경의 최종 rendered Operator surface를 보여 주며 현재 UI review에 사용되는 `docs/ui-evidence/`의 wide/narrow screenshots.
- **Historical UI evidence**: 이전 구현 상태를 보여 주지만 현재 결과를 승인하거나 리뷰하기 위한 primary evidence로 사용되지 않는 screenshots.

## Decisions

- 이번 작업은 다음 세 가지 결과 단위로 다룬다.
  1. **Project navigation 정리**: 기존 Project navigation에 configured GitHub repository를 포함하고, 관련 외부 링크들이 하나의 secondary navigation 역할로 자연스럽게 이해되도록 정리한다.
  2. **Task surface의 의미 중복 정리**: heading, label, detail copy, 반복 navigation 및 supporting metadata를 검토해 같은 의미를 반복하는 표현을 줄이고 primary task information의 scanability를 높인다.
  3. **단일 accent 도입과 시각적 마감**: 기존 neutral hierarchy를 유지하면서 하나의 muted blue accent를 실제 interactive 의미가 있는 곳에 제한적으로 적용하고 wide/narrow 결과를 함께 다듬는다.

- GitHub repository URL은 새 설정을 추가하지 않고 기존 `github_repository_url`을 Operator UI에 전달하여 사용한다. URL normalization이나 Project identity의 authority는 기존 Project configuration 경계를 따른다.
- Repository navigation은 Project-level 정보다. 특정 task details마다 반복하지 않고 Project 전체에 자연스럽게 적용되는 navigation으로 취급한다.
- PR navigation은 이번 작업에서 구현하지 않는다. 현재 `/api/v1/tasks`는 Notion task reader 결과를 제공하며 Workpad 또는 delivery PR identity를 task와 결합하지 않는다. PR link 하나를 위해 workspace 탐색, Workpad parsing, task-workspace correlation 또는 GitHub polling 책임을 Operator UI server에 새로 추가하지 않는다.
- 이후 다른 작업에서 authoritative PR URL이 기존 task/read model에 포함되면, task-level navigation에 조건부로 노출하는 방향을 사용할 수 있다. PR 정보가 없는 task에는 아무 placeholder도 두지 않는다.
- 현재 화면에 존재하는 `Project work`, `Current project work`, `Tasks`처럼 가까운 위치에서 같은 맥락을 반복하는 heading 계층은 실제 구분에 필요한 수준으로 축소한다. 정확한 문구와 남길 heading은 최종 rendered hierarchy를 기준으로 정한다.
- task title 자체의 Notion navigation과 details 내부의 명시적 Notion navigation처럼 같은 destination을 반복하는 경우, 각각이 별도 UX 가치를 제공하는지 확인하고 그렇지 않으면 하나의 명확한 경로로 단순화한다.
- State처럼 값 자체와 주변 context만으로 의미가 충분한 metadata에 반복 label을 붙이는 표현도 같은 기준으로 검토한다. 접근성에 필요한 명칭은 visual duplication과 별도로 유지한다.
- footer나 help copy가 이미 화면 구조 또는 실제 links가 전달하는 ownership을 다시 설명할 뿐이라면 축소하거나 제거할 수 있다. 반대로 failure나 publication 결과처럼 사용자의 다음 행동을 바꾸는 설명은 단순한 중복으로 취급하지 않는다.
- accent는 한 가지 blue hue만 사용한다. 구체적인 색상 값은 구현 시 실제 neutral palette와의 조화 및 contrast를 기준으로 정하되 쨍한 고채도 색상은 사용하지 않는다.
- accent를 State별 badge, task group별 색상, panel background 또는 decorative rail 등으로 확장하지 않는다. 링크, focus/selection 또는 primary continuation처럼 interaction을 이해하는 데 도움이 되는 제한된 역할에 우선 적용한다.
- hover/focus/disabled 상태 때문에 별도 hue 체계를 만들지 않는다. 필요한 상태 차이는 동일 accent와 기존 neutral 표현 안에서 해결한다.
- 기존 border와 box를 색으로 대체하지 않는다. 구조적으로 불필요한 boundary는 제거하고, 필요한 form/control/result boundary는 유지한다.
- `docs/DESIGN.md`는 현재도 “색은 hierarchy를 강화할 수 있지만 대신해서는 안 된다”는 원칙과 monochrome에서도 구조가 성립해야 한다는 원칙을 이미 포함한다. 이번 단일 파란색 선택 자체를 새로운 영구 디자인 규칙으로 추가하지 않는다. 실제 작업에서 기존 문서로 설명할 수 없는 durable principle이 발견되지 않는 한 DESIGN 문서는 변경하지 않는다.
- Human Review 및 active work ordering, Blocked By 의미와 Publisher/Notion authority, task polling, publication contract는 보호 범위다. 이번 작업에서 그 책임이나 동작을 변경하지 않는다.
- Operator UI가 GitHub API를 직접 호출하는 구조를 만들지 않는다. GitHub repository link는 기존 Project configuration을 표현하는 navigation일 뿐이며 새로운 GitHub runtime integration이 아니다.
- 범용 design system, theme framework, color system, 새로운 component abstraction은 만들지 않는다. 현재 Operator surface에 필요한 최소 표현만 유지한다.
- 최종 rendered UI는 repository의 `docs/ui-evidence/`에 wide/narrow screenshots로 남긴다. 이 파일들은 단순 기록용이 아니라 현재 UI 변경을 리뷰하기 위한 authoritative visual evidence로 취급한다.
- UI evidence의 파일명은 Operator surface와 wide/narrow viewport를 명확히 식별할 수 있게 한다. 동일한 surface의 오래된 screenshots를 current evidence와 함께 무분별하게 누적하지 않는다.
- 최종 UI review에서는 repository에 committed된 screenshots를 primary evidence로 사용한다. source code, CSS diff, `docs/DESIGN.md`는 intent와 implementation context를 이해하는 보조 evidence이며 실제 rendered result가 성공했음을 대신하지 않는다.
- 파일, module, component 및 주요 함수 이름은 현재 담당하는 Project navigation, task presentation, publication 등의 실제 책임을 드러내야 하며 이번 작업만을 위한 추상적인 design-system 이름을 새로 만들지 않는다.
- 최종 Pull Request를 만들기 전 계획을 `docs/plans/active/2026-10-04-operator-ui-navigation-and-accent.md`에서 `docs/plans/completed/`로 이동한다.

## Verification

1. **Project repository navigation**
   - 실제 Operator config readback에서 configured `github_repository_url`과 UI가 노출하는 repository destination이 같은 Project를 가리키는지 확인한다.
   - rendered Operator 화면에서 GitHub repository navigation을 실행하여 configured repository로 이동할 수 있는지 확인한다.
   - repository navigation이 Notion Tasks/Symphony 등의 Project-level navigation과 함께 이해되면서도 task surface보다 강하게 경쟁하지 않는지 wide/narrow 화면에서 확인한다.

2. **PR navigation boundary**
   - `/api/v1/tasks`와 Operator server read model을 확인하여 이번 변경이 Workpad parsing, workspace discovery, GitHub PR lookup 또는 추론된 PR URL을 추가하지 않았음을 확인한다.
   - 실제 task에 authoritative PR URL이 제공되지 않는 현재 조건에서 UI에 PR placeholder 또는 예상 link가 나타나지 않는지 확인한다.

3. **Semantic duplication과 hierarchy**
   - 최종 rendered UI를 변경 전 evidence와 비교하여 가까운 위치에서 동일 의미를 반복하던 heading, labels, navigation 및 explanatory copy가 감소했는지 확인한다.
   - 제거된 표현 없이도 Project identity, primary tasks, current State, Blocked By context 및 available navigation을 자연스럽게 이해할 수 있는지 확인한다.
   - task가 여러 개 있는 실제 또는 representative dataset에서 Human Review와 active work가 먼저 발견되고 supporting information 때문에 scan cost가 증가하지 않는지 확인한다.

4. **Accent와 전체 시각 결과**
   - 최종 CSS와 rendered UI에서 neutral palette 이외의 제품 accent가 하나의 blue hue에 한정되는지 확인한다.
   - wide와 narrow screenshot을 직접 리뷰하여 accent가 지나치게 선명하거나 넓은 면적을 점유하지 않고, interactive/continuation 의미를 보조하는 수준인지 확인한다.
   - screenshot을 grayscale 또는 색상 의미를 무시하고 보더라도 hierarchy, State, task grouping, primary action을 이해할 수 있는지 확인한다.
   - accent가 새로운 box, rail, badge 집합 또는 State color system으로 확장되지 않았는지 확인한다.

5. **기존 behavior 보존**
   - 기존 Operator UI automated tests와 production build를 실행한다.
   - 실제 또는 representative Operator surface에서 task refresh, refresh failure 후 last-successful-data 유지, task navigation, Blocked By selection/removal, Plan/State 입력, publication result navigation을 확인한다.
   - UI presentation 변경에 따라 test assertion을 변경해야 할 경우 기존 product behavior 보장을 약화하지 않는다.

6. **Repository UI evidence와 reviewability**
   - 최종 상태의 Operator UI를 representative data로 wide와 narrow viewport에서 렌더링하고 screenshots를 생성한다.
   - 생성한 screenshots를 `docs/ui-evidence/`에 commit하여 repository만으로 현재 rendered UI를 다시 검토할 수 있게 한다.
   - screenshots에는 Project navigation, primary task hierarchy, State, Blocked By context, task-level navigation 및 publication surface가 실제 화면에서 어떻게 관계를 이루는지 판단할 수 있을 만큼 충분한 영역이 포함되어야 한다.
   - wide와 narrow evidence 모두에서 동일한 정보 우선순위와 interaction 의미가 유지되는지 확인한다.
   - 기존 screenshots 중 현재 결과로 오인될 수 있는 파일은 제거하거나 명확히 current evidence가 아님을 구분한다.
   - repository에 committed된 screenshots를 별도의 UI-only review에 직접 입력하여 visual hierarchy, composition, balance, density, spacing, typography, grouping, surface treatment, affordance, scanability, responsiveness 및 overall coherence를 판단한다.
   - 해당 review는 implementation correctness, Accepted Plan compliance, repository contracts와 분리하여 실제 rendered interface 자체를 평가한다.
   - reviewer가 source code나 design rationale를 성공의 근거로 대신 사용하지 않고, committed wide/narrow screenshots를 primary evidence로 판단할 수 있어야 한다.
   - UI review에서 현재 결과에 대한 material finding이 나오면 finding을 실제 rendered evidence와 대조하여 처리하고, UI가 변경된 경우 screenshots도 새 HEAD의 결과로 다시 생성하여 review evidence를 갱신한다.

대표 browser surface 또는 필요한 interaction을 실제로 검증할 수 없는 경우 narrower test 결과로 동일한 claim을 대신했다고 간주하지 않는다. 확인하지 못한 requirement와 남는 불확실성을 명시한다.

최종 UI screenshots를 만들거나 repository에 남길 수 없는 경우 UI evidence requirement는 충족된 것으로 보지 않는다.

## Verification Tools

- **Operator UI browser surface**: Project navigation, 실제 interaction, hierarchy, semantic duplication, responsive UX 확인.
- **Wide/narrow browser screenshots 및 `docs/ui-evidence/`**: repository에 남는 authoritative rendered evidence이며 최종 UI-only review의 primary input.
- **Independent UI-only review**: committed screenshots를 기준으로 실제 visual hierarchy, composition, balance, typography, density, affordance, scanability, responsiveness 및 coherence를 평가.
- **Operator `/api/v1/config` readback**: GitHub repository navigation이 canonical Project configuration을 사용하는지 확인.
- **Operator `/api/v1/tasks` 및 server read model**: PR navigation을 위해 새로운 추론 또는 Workpad coupling이 추가되지 않았는지 확인.
- **Operator UI automated tests**: task ordering, Blocked By selection/draft 및 보호되는 UI behavior 확인.
- **Production UI build**: React/Vite 결과가 production artifact로 정상 생성되는지 확인.
- **Representative publication flow**: Plan publication, State, Blocked By, success/failure continuation의 기존 behavior 유지 확인.
- **Repository diff**: 변경 범위가 Operator presentation/navigation에 머물고 Publisher, Notion authority, Symphony lifecycle 또는 workflow contract로 번지지 않았는지 확인하고 UI evidence가 최종 HEAD와 함께 포함되었는지 확인.
