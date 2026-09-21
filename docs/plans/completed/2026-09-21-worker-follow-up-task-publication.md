# 2026-09-21-worker-follow-up-task-publication

## Objective

Accepted Plan을 수행하는 Symphony worker가 현재 작업 범위를 넘어서는 별도 작업을 기존 Publisher 경로로 canonical `Backlog` task로 publish하고, 현재 bound task의 `Blocked By`에 그 task를 additive하게 추가할 수 있게 한다.

## Intent

Worker가 실행 중 발견한 범위 밖 작업을 공식 Leesh Loop task로 남기고 현재 task가 그 작업에 의해 막혀 있음을 표현할 수 있어야 한다. 새 task publication과 현재 task relation 수정은 서로 독립된 capability이며 기존 Publisher canonical representation과 lifecycle semantics를 유지한다.

## Verification Requirements

1. 실제 bound Symphony worker session에 새 Plan publication capability와 current-task `Blocked By` capability가 노출된다.
2. publication은 기존 Publisher의 canonical schema, Identifier, Plan relation/content, locking, incomplete-publication handling 및 State-selection 경계를 재사용하고 final State를 `Backlog`로 선택한다.
3. current-task capability는 runtime binding에서 정한 task만 수정하고, blocker relation 전체를 교체하지 않으며 기존 relation을 보존한다.
4. publication과 relation mutation은 별도 호출 경계와 책임을 유지하고 각 하위 실패를 caller에게 실패로 전달한다. worker-facing 자동 retry/fallback은 추가하지 않는다.
5. `WORKFLOW.md`에 두 capability와 current-task-only / non-arbitrary-Notion 경계를 반영한다. `docs/WORKFLOW_TEMPLATE.md`는 수정하지 않는다.
6. focused unit/regression tests로 State selection, publication failure propagation, bound-task authorization, additive relation update, 기존 Publisher/lifecycle behavior를 검증한다.
7. 가능한 경우 미리 정의한 Plan A/B를 기존 main Symphony 경로에서 실행해 B의 `Backlog` publication, 다른 기존 task D 대상 mutation 거부 및 D 불변, A의 additive `Blocked By` readback을 확인한다. 핵심 evidence 확보 직후 A와 B를 `Cancelled`로 전환하고 readback한다. live 접근이 없으면 정확한 표면별 한계를 기록한다.

## Definitions

- **Plan A / task A**: 실제 Symphony worker에 dispatch하는 검증용 Plan/task.
- **Plan B / task B**: A의 worker publication capability가 `Backlog`으로 생성하는 검증용 canonical task.
- **task D**: database에 이미 존재하는 A가 아닌 task. current-task mutation 경계 검증용이며 생성/cleanup하지 않는다.
- **blocker C**: 검증 전 A에 존재할 수 있는 기존 `Blocked By` relation.
- **worker publication capability**: 제공된 Plan text를 현재 configured database에 Publisher 경로로 `Backlog` task로 생성하는 제한된 capability.
- **current-task Blocked By capability**: runtime에 bound된 task의 `Blocked By`에 다른 canonical task page identity를 추가하는 제한된 capability.

## Decisions

1. Publisher는 publication만 소유한다. current task relation mutation은 별도 worker-facing module이 소유한다.
2. Publisher의 기존 caller와 기본 final State `Ready`는 유지한다. worker caller만 명시적으로 `Backlog` State를 선택한다.
3. current task identity는 tool argument가 아니라 session binding에서 결정한다. capability 입력은 blocker canonical page identity뿐이며 arbitrary target task 입력은 노출하지 않는다.
4. blocker 추가 전에 bound task와 blocker가 같은 canonical task data source의 task page인지 확인하고, 현재 `Blocked By` relation을 readback한 뒤 기존 page IDs와 새 blocker를 함께 patch한다.
5. publication은 기존 Publisher CLI/entry point를 호출하고 그 결과의 canonical `identifier`와 `page_id`를 반환한다. 별도 task/Plan schema 구현은 만들지 않는다.
6. provider failure, command failure, malformed publication output, authorization failure는 성공으로 변환하지 않는다. 새 lifecycle state, retry, fallback, general Notion management API는 추가하지 않는다.
7. Symphony scheduling, polling, dispatch, continuation, lifecycle, Human Review 계약 및 canonical Notion schema는 변경하지 않는다.
8. 새 주요 이름은 `PlanPublication`과 `CurrentTaskBlockedBy`처럼 책임을 드러내야 한다. generic service/manager/runtime abstraction은 만들지 않는다.

## Verification

- Publisher tests에서 기본 publication이 계속 `Ready`이고, 명시적 `Backlog` 선택이 최종 State에 반영되며 canonical Plan representation이 그대로 사용되는지 확인한다.
- Notion agent-tool tests에서 두 capability의 advertised schema와 성공/실패 응답을 확인한다. publication runner failure와 current-task provider failure가 모두 `success: false`인지 확인한다.
- current-task tests에서 bound task page만 mutation되고, blocker page가 canonical/out-of-scope가 아니면 patch가 실행되지 않으며, 기존 `{C}`에 B를 추가하면 patch relation이 `{C,B}`를 모두 포함하는지 확인한다. tool에 arbitrary target property를 넣는 경로는 거부한다.
- `WORKFLOW.md` 및 adapter documentation의 capability 경계를 구조적으로 확인한다.
- 구현 후 `git diff --check`, Publisher test/build, Symphony focused tests 및 가능한 전체 로컬 gate를 실행한다.
- delivery PR과 정확한 HEAD를 확인한 뒤 `chatgpt-shot submit`으로 behavior review를 수행한다. finding은 현재 HEAD에서 독립 재현한 경우만 수정하고, 수정으로 HEAD가 바뀐 경우 finding 없는 결과까지 재검토한다. 그 다음 동일 PR/HEAD에 structural review를 수행한다.

## Verification Tools

- `operator/notion_publisher` Publisher tests/build: canonical publication과 State selection.
- `operator/symphony` ExUnit focused tests: worker tool surface, binding, additive relation 및 failure propagation.
- 기존 main Symphony 실행 경로와 live Notion readback: 실제 production-path publication/authorization/relation/cleanup evidence.
- `chatgpt-shot submit` 및 `jobs`: exact PR HEAD 독립 behavior/structural review.

## chatgpt-shot review log

- Round 1 — reviewed HEAD `5fb7558694abd20af6bc00237b1f66aff5bf4b51`; verdict `FINDINGS`.
  Accepted the one independently reproduced medium finding: paginated Notion relation
  property items were parsed by their property-item `id` before nested blocker page
  `relation.id`, so existing blockers could be replaced with property-item IDs. Fixed in
  commit `1c4062954f1aa4c7ada061cef449190e76075951`; targeted capability tests and the
  full `mix test` suite passed.
