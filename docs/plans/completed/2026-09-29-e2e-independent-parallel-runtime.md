# 2026-09-29-e2e-independent-parallel-runtime

## Objective

E2E를 `operator` 하위의 특수 Project 실행이 아니라 repository-level 독립 harness로 정리하고, 사용자가 제공한 독립 E2E Notion database pool capacity만큼 서로 격리된 Operator/Symphony runtime을 병렬 실행할 수 있게 한다.

## Intent

현재 E2E는 production Publisher → Operator → Symphony → worker 경로를 구동하지만, `operator/e2e`와 별도 Project configuration을 통해 Operator의 특수 Project처럼 표현되어 있다. E2E는 production Operator와 Symphony의 실행을 준비하고 격리하며 관찰하고 종료하는 repository-level 검증 harness로 소유해야 한다.

Production과 의미상 같아야 하는 repository, base source, Codex model 및 reasoning 설정은 `operator/project.json`을 authority로 사용한다. Production Project 전체를 E2E에 상속하지 않으며, workspace, state, readiness, ports와 같이 E2E의 sandbox 및 run 격리에 민감한 정책은 E2E가 소유한다. 제공된 per-run workflow는 별도 실행 입력으로 유지한다. 기본 workflow가 없을 때는 production root workflow의 외부 app/capability 요구를 가져오지 않는 E2E-owned sandbox-compatible workflow를 사용한다.

E2E는 현재 지원하는 Symphony worker sandbox 안에서 계속 실행 가능해야 한다. Worker가 production Operator나 Symphony를 직접 시작하지 않고 E2E-owned boundary를 요청하게 한다. 각 E2E run은 하나의 database와 독립 Operator/Symphony child runtime을 사용한다. 사용자 제공 database pool은 가용 capacity를 표현하며 고정 concurrency 수를 만들지 않는다. 한 database의 active run, interrupted run, cleanup 실패 또는 recovery 실패는 다른 database의 독립 실행을 막지 않는다.

## Verification Requirements

1. E2E ownership은 repository top-level `e2e/`에 있어야 한다. 사용자가 관리하는 E2E Project configuration은 필요하지 않아야 하며, 기존 production Operator의 일반 `start`/`stop` 동작은 바뀌지 않아야 한다.
2. E2E가 production authority로부터 사용할 설정은 repository identity, configured production base source, Codex model 및 reasoning effort로 한정한다. `workspace_files`, workspace root, state directory, fixed ports, external readiness 또는 production Project 전체를 자동 상속하지 않아야 한다.
3. Repository에서 실행하는 `npm run e2e`와 Symphony worker에서 요청하는 E2E run은 동일한 E2E-owned execution boundary, durable run lifecycle, recovery pass, database reservation 의미를 사용해야 한다. Worker-originated run은 outer runtime 및 execution provenance를 기록하되 이를 database liveness의 유일한 근거로 삼지 않아야 한다. Worker는 production `npm start`나 직접 Symphony startup으로 child runtime을 만들지 않아야 한다.
4. E2E는 현재 worker sandbox에서 실행 가능해야 한다. 일반 실행을 위해 worker 권한, filesystem 범위, host-global workspace 또는 danger-full-access를 넓히지 않아야 한다. E2E workspace, runtime state, 임시 파일 및 실행 artifact는 해당 run의 sandbox에서 접근하고 정리할 수 있어야 한다.
5. Workflow 미지정 실행은 E2E-owned sandbox-compatible default workflow를 사용해야 하며 production root workflow를 암묵적으로 사용하지 않아야 한다. 기존 provided-workflow 입력은 byte와 pass-through 의미를 보존해야 한다.
6. Pool은 사용자가 추가·제거할 수 있는 복수 database URL로 구성되어야 하고, URL 개수나 별도 concurrency 수 변경 없이 database를 추가하거나 제거한 결과가 가용 capacity에 반영되어야 한다. 초기 pool은 기존 `.env`의 E2E database와 다음 네 database를 포함한다.

   - `https://app.notion.com/p/studyleesh/3ea8a265862580348507c385c5e9c594?v=3ea8a2658625800a9e69000cf6e055fd`
   - `https://app.notion.com/p/studyleesh/3ea8a2658625804781e0ead9c231fc10?v=d3a8a26586258361bab908ea713fdf9b`
   - `https://app.notion.com/p/studyleesh/3ea8a265862580fabecdd4c35fd81425?v=0058a265862582d5856a880f3f425bb3`
   - `https://app.notion.com/p/studyleesh/3ea8a2658625805bb64cd3068d1794ef?v=4a78a265862583f0b4718836810b2beb`

7. Database reservation state는 URL 표현, pool 순서·부분집합·fingerprint, checkout 및 worker workspace와 독립된 stable database identity를 사용해야 한다. 서로 다른 workspace와 pool 구성이 같은 database의 동일 shared reservation/recovery state를 관찰해야 한다.
8. Database는 `available`, `in use`, `unavailable`을 구분해야 한다. 하나의 database는 최대 하나의 run만 사용하며, 하나의 run은 동시에 최대 하나의 database reservation만 보유해야 한다. 동시 경쟁에서 `available → in use(run)`은 단 하나만 성공해야 한다. `in use → unavailable` 및 marker 조건부 `unavailable → available`도 원자적이고 조건부여야 한다. Old run에서 new run으로 직접 reservation을 넘기는 경로는 허용하지 않는다.
9. 모든 지원 진입점은 candidate selection 전에 recovery pass를 실행해야 한다. Active이거나 liveness가 불명인 run/child runtime은 유지해야 한다. Outer worker 종료만으로 stale을 판정하지 않으며, child runtime이 살아 있거나 확인 불가능한 database를 재배정하거나 정리해서는 안 된다. Dead run은 먼저 `in use → unavailable`을 거친 뒤 recovery를 완료해야 한다.
10. 각 `unavailable` 발생은 과거·이후 상태와 구분되는 durable recovery marker를 가져야 한다. Recovery 완료는 자신이 검사한 marker가 여전히 current인 경우에만 성공해야 한다. 상태가 바뀌어 완료가 거부된 recovery도 시도 marker와 최신 authoritative state를 evidence에 남겨야 한다.
11. Recovery가 완료되려면 이전 run 및 child runtime이 database를 더는 사용할 수 없음, 필요한 stale task cleanup, Workpad/State readback 및 unresolved cleanup 부재를 확인해야 한다. `Backlog`, `Done`, `Cancelled`는 보존한다. 그 밖의 task는 이전 State, E2E cleanup 사실, 시간, recovery/run/runtime identity를 Workpad에 먼저 기록하고, 그 기록과 `Cancelled` State를 authoritative readback해야 한다. 확인이나 cleanup 중 하나라도 실패하면 database는 계속 `unavailable`이어야 한다. 실패는 해당 database에만 국한되어야 한다.
12. Reservation 전에는 task reconciliation, admission, publication 및 workflow workload를 시작하지 않아야 한다. 허용된 finite admission/retry 범위에서 capacity contention으로 reservation을 얻지 못하면 workload를 시작하지 않고 `resource unavailable admission`으로 종료한다. 정상 contention 자체는 database failure나 `unavailable` 상태를 만들지 않아야 한다. 별도 scheduler, queue 또는 unbounded retry를 추가하지 않는다.
13. 실제 사용 중인 database의 finalization 또는 required cleanup 실패는 run failure여야 하며 reservation을 중간 `available` 관찰 없이 `unavailable`로 전환해야 한다. Unavailable 원인, marker, run/runtime/provenance, lifecycle 및 cleanup/readback 결과, 최종 recovery 결과는 durable internal evidence에서 확인 가능해야 한다.
14. 병렬 run은 독립 workspace, state, run record, workflow/workload evidence, Git branch 및 cleanup ownership을 가져야 한다. Operator/Symphony child runtime과 UI/runtime ports도 run마다 분리되어야 한다. 한 run의 cleanup이나 실패가 다른 run 소유 resource를 바꾸지 않아야 한다.
15. 실제 production path 검증에서 최소 두 run이 서로 다른 database와 port로 겹쳐 실행되고, 각각 Publisher → Operator → Symphony → worker 흐름과 lifecycle/evidence/finalization을 독립적으로 완료해야 한다. 또한 서로 다른 outer worker workspace에서 시작된 run이 database와 pool 구성에 관계없이 같은 shared reservation contract를 사용하는지 확인해야 한다.

## Definitions

- **E2E harness**: production Publisher, Operator, Symphony, worker 및 외부 경로를 실제로 구동·관찰·종료하는 repository-level E2E 책임.
- **E2E run**: recovery pass부터 database 선택, child runtime, workload 및 finalization까지 이어지는 하나의 독립 실행.
- **database pool**: candidate discovery와 사용 가능한 capacity를 표현하는 E2E Notion database URL 집합.
- **stable database identity**: URL 형식과 pool 구성에 관계없이 하나의 실제 Notion database를 식별하는 canonical identity.
- **shared reservation authority**: 서로 다른 지원 invocation이 같은 stable database identity의 상태를 관찰하고 필요한 조건부 원자 전이를 수행하는 shared authority.
- **database reservation**: 하나의 E2E run이 특정 database를 독점 사용하는 durable 상태.
- **child runtime**: E2E run이 production 경로 검증을 위해 시작한 독립 Operator/Symphony process 집합.
- **outer execution provenance**: worker-originated 실행을 요청한 outer Operator/Symphony identity. 출처 evidence이며 child database liveness 판정만을 대신하지 않는다.
- **recovery marker**: 하나의 특정 `unavailable` 상태를 이전·이후 recovery 상태와 구분하는 durable identity.
- **resource unavailable admission**: workload 전에 허용된 admission 범위 안에서 reservation을 얻지 못해 종료된 결과.
- **stale task residue**: dead run/runtime이 database를 사용할 수 없는 상태에서 `Backlog`, `Done`, `Cancelled` 이외 State로 남은 task.

## Decisions

### Ownership 및 설정

E2E는 top-level `e2e/`에서 production `operator`를 호출·관찰하는 dependency 방향을 사용한다. `operator/e2e/project.json`과 동등한 사용자가 관리하는 E2E Project surface를 제거한다. Production Project는 shared Operator setting의 authority이며 E2E의 parent object가 아니다.

Production Project에서 읽는 repository/base/Codex 설정은 E2E runtime에 필요한 값만 선택하여 전달한다. Workflow, workspace, state, readiness, temporary ports, timeout, polling, cleanup은 E2E policy로 소유한다. Default workflow는 E2E 안에 두고, provided workflow는 별도 run input으로 그대로 전달한다.

### Execution 및 lifecycle

Direct `npm run e2e`와 worker-originated request는 같은 E2E-owned command boundary와 run lifecycle을 사용한다. Worker는 E2E boundary만 요청하며 production Operator/Symphony startup을 직접 실행하지 않는다. Run origin과 outer provenance는 기록하되 reservation 및 liveness 의미를 바꾸지 않는다. Database liveness는 durable E2E run lifecycle과 실제 child runtime 상태를 함께 확인한다.

### Reservation, recovery 및 admission

Recovery는 모든 run 시작에서 normal candidate selection 전에 수행한다. Active/unknown `in use`는 보존하고, 죽었다고 authoritative하게 확인된 run만 conditional unavailable 전이를 거친다. Recovery marker가 검사 후 바뀌면 오래된 결과로 최신 상태를 덮어쓰지 않는다.

Unavailable recovery가 stale task를 처리하는 순서는 authoritative task read, Workpad provenance append 및 readback, `Cancelled` 전환, Workpad/State 최종 readback이다. Recovery 결과를 확인하지 못하면 capacity를 복구하지 않는다. Capacity contention은 기존 E2E의 finite retry 의미 안에서 처리하며 별도 scheduler를 만들지 않는다.

Shared reservation authority 및 conditional atomic update의 저장 기술은 이 계획에서 고정하지 않는다. Pool은 candidate list일 뿐 namespace나 reservation state를 만들지 않는다.

### Protected scope 및 naming

Production `npm start`/`npm stop`, 일반 Operator Project 의미, Publisher canonical publication, Symphony worker lifecycle 및 sandbox 보안 모델을 변경하지 않는다. 기존 Accepted Plan/provided Plan 의미, provided workflow pass-through, run-scoped Git ownership 및 production workflow semantics도 보존한다. E2E를 위해 worker sandbox를 일반적으로 넓히지 않는다.

용어는 `E2E run`, `database reservation`, `shared reservation authority`, `available`, `in use`, `unavailable`, `recovery marker`, `child runtime`, `outer execution provenance`, `recovery pass`, `database recovery`, `recovery evidence`, `capacity contention`, `resource unavailable admission`을 사용한다. 아직 없는 scheduler/cluster abstraction이나 특정 storage implementation을 전제로 이름을 짓지 않는다.

## Verification

- Production `operator/project.json`에서 실제 runtime에 들어간 repository/base/model/reasoning 값을 확인하고, workspace files, production workspace/state 경로, fixed ports 및 external readiness가 자동 상속되지 않는지 읽어 본다.
- 직접 `npm run e2e`와 worker workspace의 `npm run e2e` 요청으로 run identity, run origin/provenance, selected database, shared reservation, child runtime 및 최종 lifecycle을 확인한다. 정상 종료 후 E2E run record와 shared authority를 다시 읽는다.
- Default workflow 실행에서 E2E-owned workflow와 sandbox-compatible workspace bootstrap이 사용되는지 확인한다. 별도 provided workflow 실행에서 전달한 document가 수정 없이 run input으로 남는지 확인한다.
- 초기 pool의 다섯 stable database identity, pool 추가·제거에 따른 capacity 변화, URL 표현과 pool 부분집합에 관계없는 shared state를 확인한다.
- Active/unknown run 보호, dead run의 unavailable 경유, 실패한 cleanup의 unavailable 유지, marker가 오래된 recovery 거부, Workpad-before-State stale cleanup 및 최종 Notion readback을 확인한다.
- Pool보다 많은 동시 admission으로 단일 database 단일 승자, loser의 state 비변경, workload 미시작 resource-unavailable 결과 및 다른 database의 독립 admission을 확인한다.
- 실제로 서로 다른 두 database에서 두 child runtime을 겹쳐 실행한다. run ID, DB identity, Operator/Symphony runtime ID와 ports, workspace, state, task evidence 및 cleanup ownership을 확인하고 두 run의 독립 finalization을 읽어 확인한다.
- 서로 다른 outer worker workspace와 다른 pool 구성을 사용해 같은 database의 reservation/recovery state가 공유되고, outer worker 종료 후 child runtime이 살아 있으면 recovery/admission이 막히는지 확인한다.
- E2E focused tests, 직접 영향이 있는 Operator/Symphony regression tests, Publisher tests와 `git diff --check`를 실행한다. Lower-level tests는 production path 확인을 대신하지 않는다.

## Verification Tools

- **`npm run e2e`**: direct 및 worker-requested E2E entry, recovery/admission, production Publisher → Operator → Symphony → worker path와 최종 run evidence를 확인한다.
- **Shared reservation authority readback**: stable identity별 상태, reservation, recovery marker 및 durable evidence를 확인한다.
- **E2E run record**: origin, provenance, database binding, ports, runtime, workload, cleanup 및 final lifecycle을 확인한다.
- **Symphony `/api/v1/state`, `/api/v1/executions`, `/api/v1/runtime`**: worker task lifecycle, execution history, child runtime identity/liveness를 확인한다.
- **Notion authoritative readback**: recovery 대상 task의 Workpad provenance와 최종 State를 확인한다.
- **Focused automated tests 및 Operator/Symphony/Publisher tests**: 조건부 전이, race 결과, workflow/config 분리와 회귀 경계를 확인한다.
