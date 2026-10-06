# 2026-10-06-e2e-branch-cleanup-and-run-summary

## Objective

E2E 실행이 정상 종료되면 실행 과정에서 생성한 원격 branch/ref가 repository에 잔여물로 남지 않게 하고, 결과는 실제 repository에 병합 가능한 작고 유용한 실행 요약으로 남긴다. 실행 중 상세 진단 정보는 계속 사용할 수 있어야 하지만 원격 branch를 장기 로그 저장소로 누적하지 않는다.

## Intent

현재 E2E는 서로 다른 checkout과 sandbox 사이에서 Notion database를 안전하게 예약하기 위해 공유 상태가 필요하며, 원격 Git ref는 현실적인 coordination 수단이다. 문제는 shared coordination과 실행 history/logging이 결합되어 e2e-internal ref가 상태 전이마다 쌓이고 정상 종료 후에도 남는 점이다.

Remote Git은 실행 중 필요한 coordination에 한정하고 normal settlement 후 정리한다. 상세 evidence는 실행 중 진단 용도로 유지하되 장기 보존을 확대하지 않는다. 최종 결과 중 의미 있는 정보만 압축한 run별 repository summary를 outer checkout에 남겨 기존 작업의 일반 Git delivery로 main에 병합 가능하게 한다. Harness는 summary를 생성할 뿐 stage/commit/push하거나 별도 branch/PR을 만들지 않는다.

Notion State와 Workpad는 실제 worker lifecycle과 작업 결과를 설명하는 surface로 유지한다. Workpad에 harness 내부 구현이나 별도의 E2E logging 개념을 드러내지 않는다.

## Requirements

1. 정상 완료한 run은 자신이 생성하거나 소유한 run-scoped base branch, delivery branch, database reservation coordination ref 및 run lifecycle coordination ref를 정리한다. Normal settlement 후 새 E2E-owned remote branch/ref가 남지 않는다.
2. Database reservation의 single-winner 병렬 안전성, stale recovery rejection, active runtime 보호를 유지한다. 서로 다른 checkout에서 동일 database를 동시에 예약할 때 최대 하나만 획득하며 active 또는 liveness 확인 불가 run의 database를 재사용하지 않는다.
3. Crash, interrupted finalization 또는 recovery 동안 안전한 recovery에 필요한 최소 current shared state만 남을 수 있다. 이는 append-only history가 아니며 recovery와 settlement가 끝나면 제거한다. Cleanup 실패를 감추기 위해 ref를 삭제하지 않는다.
4. 기존 e2e-internal historical sequence refs를 정리한다. Active/unavailable reservation 및 recovery의 authoritative current state를 보존한 다음 obsolete sequence refs를 제거하고, 이미 settled된 stream의 event history는 이관하거나 보존하지 않는다.
5. 실행 중 e2e/runs/<run-id>/run.json 수준의 상세 evidence와 snapshots를 계속 쓸 수 있다. 상세 로그를 main, 장기 branch, 별도 artifact/logging service에 복제하지 않는다.
6. 종료한 run마다 outer repository checkout의 source-controlled, non-ignored history 경로에 독립 summary 파일을 생성한다. Summary는 immutable이며 병렬 run끼리 overwrite나 shared append log contention이 없다. Worker workspace 실행에서는 기존 worker delivery의 일반 변경으로 포함될 수 있고 직접 checkout에서도 일반 working-tree 변경으로 남는다.
7. Summary에는 run identity와 시각/duration, workload/task identity, 의미 있는 lifecycle, terminal/result 상태, 존재 시 delivery/merge identity, 실패 시 stage와 짧은 원인, run-owned branch/runtime/workspace/coordination cleanup 및 settlement 결과, 결과에 영향을 준 recovery를 기록한다.
8. Summary에는 전체 polling/snapshot, temporary path/port, database URL/identity, 전체 Workpad/Accepted Plan, raw external response, environment dump, credentials/token/secret을 넣지 않는다.
9. Notion Workpad에는 Plan 진행, 검증, delivery, merge, blocker 및 recovery에 필요한 사실을 구체적으로 유지하되 E2E, internal reservation store 또는 harness implementation을 사용자-facing 기록으로 쓰지 않는다. 기존 harness recovery wording도 일반 recovery 사실 중심으로 고친다. Workpad marker나 별도 summary schema를 추가하지 않는다.
10. Publisher → Operator → Symphony → worker → delivery production path, database pool capacity 의미, task lifecycle, PR 검증, recovery, cleanup ownership을 약화하거나 우회하지 않는다. 일반 production worker branch cleanup, npm start/stop 및 Operator Project 의미는 변경하지 않는다. 새 명칭은 current coordination, run summary 또는 cleanup의 책임을 나타내고 제거되는 event history 책임을 암시하지 않는다.

## Definitions

- Shared coordination state: 서로 다른 invocation이 database reservation, liveness 또는 recovery를 안전하게 판단하는 최소 current state.
- Historical sequence ref: e2e-internal/<stream>/<sequence>처럼 상태 전이마다 추가되어 과거 event를 ref 자체로 보존하는 remote ref.
- Normal settlement: child runtime 정지, required cleanup, database release, run lifecycle settlement 및 authoritative readback 완료로 shared coordination state가 더는 필요 없는 상태.
- Transient run evidence: run.json과 실행 중 snapshots처럼 현재 run 진단/검증용이며 장기 repository 보존을 요구하지 않는 evidence.
- Run summary: 한 run의 핵심 결과를 축약해 source-controlled history 경로에 남기는 작은 독립 기록.
- Outer repository checkout: npm run e2e를 호출한 repository checkout이며 child workspace와 run-scoped target branch와 구분된다.
- Coordination residue: 안전한 recovery를 위해 일시적으로 유지되는 unresolved current reservation 또는 run lifecycle ref.

## Decisions

### Coordination and history

Remote Git may remain the cross-checkout coordination authority, but refs represent only current reservation, run lifecycle, and recovery state. Replace transition-by-transition sequence refs with a bounded current-state model whose ref count does not grow with run or transition count. Preserve atomic winner, CAS/recovery rejection, liveness and active runtime semantics. Remove reservation and run lifecycle state after normal settlement. Keep unresolved residue only while recovery needs it; it is not audit history.

An invocation may mark an earlier database candidate unavailable because it contains task residue, then continue on another candidate. Retain that invocation's terminal lifecycle state while any in-use or unavailable current reservation still references its run identity. Recovery may remove the lifecycle only after those reservation references are settled. A terminal invocation that acquired no unresolved reservation removes its lifecycle state as part of admission settlement.

### Legacy refs

For each relevant stream, determine the latest authoritative state before cleanup. Preserve active/unavailable meaning in the current representation, then remove obsolete sequence refs. Remove settled streams without preserving event history. Cleanup must not delete unrelated refs or unresolved state.

### Summary boundary

Create one independently named summary under a source-controlled, non-ignored history path in the outer checkout, not in the child run branch. File creation is the harness's only delivery responsibility. Never stage, commit, push, create a logging branch/PR, or add an escalation path. Run-scoped files avoid write contention.

### Transient evidence and Workpad

Keep current run records and snapshots for in-flight diagnosis. Do not add an artifact server, logging API, Notion logging database, or repository-wide detailed history store. Workpad remains an ordinary worker activity record; recovery text states the actual recovery outcome without exposing harness storage/implementation. Do not add a marker or parsing contract for summary generation.

## Verification

### Normal cleanup and remote readback

Run the production npm run e2e path to normal completion. Read remote refs before and after settlement from the configured repository authority. Confirm the run's base branch, delivery branch, reservation coordination ref and lifecycle coordination ref are absent; no new historical sequence ref remains; unrelated refs are unchanged. Read final run evidence and confirm finalization/readback.

### Reservation and recovery

Exercise two independent invocations/workspaces racing for one database and confirm exactly one reservation winner through shared-state readback. Confirm active or unknown-liveness runtime prevents reuse. Recreate interrupted settlement and verify active/unknown runtime is preserved, dead runs use the existing unavailable/recovery contract, only bounded current state remains, and recovery completion removes its residue without accumulating history refs.

For terminal admissions, confirm lifecycle state is removed when no reservation references that invocation and remains available to recovery when an earlier rejected candidate still has an unavailable reservation. An unreadable or invalid reservation identity must prevent lifecycle deletion.

### Legacy refs

Inventory existing sequence refs, establish latest authoritative state per stream, preserve only unresolved state in the current representation, remove obsolete history, then read back remote inventory. Confirm no historical sequence refs remain and unresolved recovery state remains safe.

### Summary

Inspect successful and failed run summaries against transient run records. Confirm identity, lifecycle, result/delivery, failure and cleanup meaning; exclude raw records, database identity, temporary paths/ports and repeated snapshots. Finish multiple runs in parallel and confirm distinct files. Check outer checkout status/diff for a visible non-ignored file and confirm the harness did not stage, commit, push or create another delivery lifecycle. Verify worker-originated summaries can travel with the existing worker delivery.

### Workpad and regression

Authoritatively reread Workpad after representative normal and stale-task recovery flows. Confirm worker progress/delivery/recovery facts remain and harness-specific logging concepts are absent.

Run focused admission/recovery and finalization tests, then relevant Operator/Publisher/Symphony regression tests, git diff --check, and a representative production-path E2E. These checks cover reservation concurrency/CAS, active runtime protection, recovery, finalization, run-owned branch deletion and summary generation while preserving production npm start/stop and worker delivery contracts.

## Verification Tools

- npm run e2e for Publisher → Operator → Symphony → worker → delivery, settlement, summary, and cleanup.
- Focused E2E admission/recovery/finalization tests for concurrency, liveness, current-state CAS, cleanup and failure semantics.
- git ls-remote --heads or equivalent configured remote readback for E2E-owned, legacy, and unrelated refs.
- run.json plus generated summary comparison for transient evidence and summary scope.
- git status/diff for non-ignored summary visibility and absence of harness delivery mutations.
- Notion authoritative readback for State and Workpad boundaries.
- GitHub PR/readback for actual workload delivery identity.
- Related Operator/Publisher/Symphony checks and git diff --check for protected boundaries.
