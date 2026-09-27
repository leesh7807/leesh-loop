# 2026-09-27-operator-task-ui

## Objective

현재 Operator의 최소 Publish 페이지를 기본 사용자용 운영 UI로 확장하고, UI를 별도의 React 계열 application으로 분리한다. 사용자는 한 Operator context에서 새 Plan을 publish하고 현재 project task와 핵심 상태를 확인하며, 상세 content는 Notion, runtime 세부 정보는 Symphony Dashboard에서 확인할 수 있어야 한다.

## Intent

Operator UI를 기본 사용자 surface로 둔다. Notion은 canonical durable task/Plan state와 상세 content의 authority이고, Symphony Dashboard는 runtime observability surface다. task 목록의 source는 canonical Notion task source다. 기본 목록에서 `Cancelled`와 `Publisher Pending`만 제외하고 다른 State는 별도 active/inactive policy로 재분류하지 않는다. 전체 대상 task에 접근 가능해야 하지만 한 번에 모두 fetch/render할 필요는 없다. 실제 task 수와 Notion read 비용에 맞춰 pagination, load-more, progressive loading, caching 또는 다른 경로를 선택한다.

Workpad와 Accepted Plan 본문은 UI로 복제하지 않는다. task page와 그 task의 canonical Accepted Plan relation에서 authoritative Notion page로 이동한다. 정상 publication task는 기존 Publisher 계약대로 정확히 하나의 Plan relation을 가지며 UI는 이를 추론하거나 fallback Plan을 만들지 않는다.

첫 UI pass는 색상·장식보다 typography, spacing, sizing, alignment, grouping, border, placement 및 responsive layout으로 정보 위계를 세운다. `Title`, `State`, `Blocked By`가 중심이고 `Priority`, `Labels`, `Identifier`는 보조 정보다. task 확인과 Plan publication은 같은 Operator context에서 연결한다. publication은 `Plan 확인/입력 → State 결정 → Publish → 결과 확인` 순서이며, Notion과 Symphony는 항상 접근 가능하되 보조 navigation이다. wide/narrow viewport와 색상 제거 상태에서도 hierarchy, action 및 success/failure/refresh 상태가 이해되어야 한다.

## Accepted requirements

- Root `npm start`가 자동으로 여는 browser surface는 Operator UI 하나다. Notion database와 Symphony Dashboard는 UI navigation으로만 연다. Symphony Dashboard 동작 자체는 바꾸지 않는다.
- React client는 별도 UI application이며 `NOTION_TOKEN`을 갖거나 Notion API를 직접 호출하지 않는다. Notion integration은 server-side boundary 뒤에 둔다.
- 기존 Publisher는 publication authority다. identifier/title derivation, duplicate handling, lifecycle, validation, State policy, canonical Plan/task representation 및 failure semantics를 복제하거나 변경하지 않는다. UI State choices는 기존 Publisher configuration에서 파생한다.
- 모든 대상 task에 접근할 수 있어야 하며 Notion query의 pagination cursor를 끝까지 이어 읽는다. 고정 task-count limit을 제품 계약으로 추가하지 않는다. read/polling 비용은 실제 project 규모에서 사용자 작업을 방해하지 않아야 한다.
- 모든 표시 task에서 `Title`, `State`, `Blocked By`를 확인한다. blocker는 relation/page ID만 노출하지 않고 blocker `Title`과 현재 `State`를 표시한다. 선택적 metadata는 secondary다.
- 각 task에서 새 tab/window로 Workpad task page를 연다. 기존 canonical Plan relation을 이용해 Accepted Plan page로 이동한다. Workpad/Plan 본문은 가져와 렌더링하지 않는다.
- 수동 reload 없이 5~10초 수준으로 갱신한다. 최초 loading과 empty를 구분한다. refresh 실패 시 마지막 성공 task 결과를 유지하고 refresh failure를 표시하며 publish controls/submission을 막지 않는다. 재시도를 계속하고 다음 성공 결과를 authoritative state로 반영한다.
- Publish 실패 시 Plan과 선택한 State를 보존하고 authoritative Publisher error를 보여 재시도할 수 있다. refresh failure가 submission 경로를 막지 않는다. 같은 dependency 장애로 submission이 실패하면 기존 Publisher 의미를 유지한다.
- 이번 범위의 task write action은 기존 Plan publication뿐이다. State, Priority, Labels, Blocked By 수정 UI를 추가하지 않는다.
- 넓은/좁은 화면에서 순서와 기능을 보존하고, 좁은 화면에서 핵심 정보나 Publish가 잘리거나 수평 overflow로 unusable하지 않아야 한다.
- `docs/ui-evidence/`에는 이번 Operator UI의 실제 결과만 남긴다. 대체된 Publish UI evidence는 정리한다. 최종 evidence는 task surface, blockers, publication, wide/narrow layout, secondary navigation, metadata hierarchy 및 실제 publication 결과를 검토할 수 있어야 한다.

## Boundaries

- Notion remains the task, Plan, Workpad and publication authority. The UI may expose read-only task data and authoritative page links; it does not mirror Plan/Workpad content or derive canonical identity.
- Publisher remains the only Plan publication path and State policy owner.
- Symphony Dashboard remains the runtime observability surface.
- Do not modify `operator/symphony/` or add task editing, publication history, arbitrary Notion management, or a replacement runtime dashboard.

## Verification

1. Run repository-root `npm start`; observe one automatically opened Operator UI, with both task and publication surfaces reachable there and no automatic Notion/Dashboard windows.
2. Use the production UI entry point and configured Notion source. Compare representative titles, States, blocker titles/States, Workpad URLs and canonical Plan URLs to Notion. Confirm all target tasks are reachable and neither excluded state is listed while other States remain.
3. Test a small pagination boundary where a query has another page/cursor, including complete access to eligible tasks beyond it.
4. Observe browser network/readback to confirm the client only calls the Operator server and does not fetch Notion content or Plan/Workpad bodies. Confirm navigation opens authoritative Notion pages in a new tab where specified.
5. Observe polling updates for task and blocker State. On a reproducible refresh failure, confirm existing results remain, failure is visible, publishing remains enabled/attemptable, polling retries, and a later success replaces the stale read.
6. Publish through the UI, read back the authoritative Notion task and Plan relation, and exercise a real Publisher failure path. Confirm the UI reflects Publisher results/errors and preserves input/context after failure.
7. Review wide and narrow browser renderings, monochrome hierarchy and all required task/publication information. Remove superseded UI evidence and retain evidence for this UI only.
8. Run the existing Operator and Notion Publisher suites, including publication validation, State selection, identifier/title, duplicate/pending recovery, canonical Plan relation, lifecycle, UI ownership and browser-open behavior. Add focused coverage for pagination and refresh failure/recovery.

## Delivery

Use a task branch from the latest configured remote base. Inspect the final diff and compare the result to this Repository Plan before handoff. Move this Plan to `docs/plans/completed/` only after verification is recorded. Create a PR against the configured base, read its identity/head back, and run both required `chatgpt-shot` code and structural reviews against that exact PR/HEAD. Prepare the normal `Human Review` handoff only after both reviews complete, preserving the delivered PR/HEAD identity.
