# 2026-09-28-e2e-remote-ref-isolation-gate

## Objective

공유 repository에서 다른 정상 작업이 만든 원격 branch의 변화 때문에 E2E run이 미해결 상태가 되거나 다음 run이 차단되지 않도록 E2E의 repository-wide remote branch isolation 검증을 제거한다.

E2E는 run이 소유한 runtime, workspace, task, base branch, delivery branch의 cleanup과 잔여 상태만 확인한다. 기존 run evidence에 기록된 unrelated branch를 E2E 소유 잔여물로 취급하지 않는다.

## Intent

현재 finalization은 run 전후 전체 remote branch 집합을 비교해 E2E가 소유하지 않은 branch의 생성·변경·삭제까지 기록한다. 생성된 unrelated branch는 unresolved_new_refs가 되어 다음 admission을 막을 수 있다. 공유 repository에서 다른 정상 task가 만든 branch까지 영향을 주므로 repository-wide branch 상태를 E2E 완료 조건으로 삼지 않는다.

unrelated remote ref에 task/PR 증거를 연결해 E2E가 보유한 잔여물인지 분류하는 방법도 이 문제의 해소 방향으로 사용하지 않는다. 확인 대상은 run이 소유한 resource의 구체적인 정리 상태다.

## Verification Requirements

- E2E finalization/admission은 전체 remote branch 목록의 run 전후 차이를 E2E 소유 resource residue로 사용하지 않아야 한다.
- 다른 task나 operator가 정상적으로 만든 remote branch가 run 중 생성·변경·삭제되어도 해당 변화만으로 현재 run이 실패하거나 다음 E2E admission이 거부되지 않아야 한다.
- 기존 run record의 unresolved_new_refs만으로는 다음 admission이 거부되지 않아야 한다. 과거 evidence를 다시 쓰지 않고, 해당 run의 명시적인 owned resource와 기존 unresolved finalization/cleanup action은 authoritative하게 재확인해야 한다.
- E2E가 생성한 run-scoped base branch와 delivery branch, runtime, workspace 및 task의 기존 cleanup·reconciliation 책임은 유지되어야 한다. Owned resource가 실제로 남았거나 정리 결과를 확인할 수 없을 때에는 해당 resource에 한정한 구체적인 unresolved evidence와 admission 동작이 있어야 한다.
- E2E는 다른 task의 branch를 변경하거나 삭제하지 않아야 하며, timing 및 workload/workflow provenance를 포함한 기존 durable run evidence를 유지해야 한다.
- 정상 production E2E가 공유 repository의 unrelated remote branch 변화와 공존하면서 기존 Publisher → Operator → Symphony → worker → delivery lifecycle 경로를 수행할 수 있어야 한다.

## Definitions

- **Owned resource**: 해당 E2E run이 생성했거나 run record로 명시적으로 소유 관계를 세운 runtime, workspace, task, run-scoped base branch 또는 delivery branch.
- **Unrelated remote branch**: 해당 run의 owned resource로 확인되지 않는 repository branch. Run 전후 snapshot에 새로 나타나거나 값이 달라졌다는 사실만으로 E2E-owned로 간주하지 않는다.
- **Repository-wide branch isolation verification**: 전체 remote branch 집합을 run 전후 비교하고 run이 소유하지 않은 ref 변화를 finalization 또는 이후 admission 차단 근거로 사용하는 방식.

## Decisions

### Remote branch verification boundary

Repository-wide remote branch snapshot/diff와 이에 기초한 unresolved_new_refs admission gate를 제거한다. Unrelated ref의 변경을 external evidence와 연결해 소유권을 추론하거나, 이를 unresolved run residue로 분류하지 않는다.

E2E-owned branch의 cleanup과 확인은 유지한다. 구현자는 전체 ref inventory 대신 run record에서 소유가 확인된 branch를 직접 다루고, 그 cleanup 결과를 durable run evidence에 기록한다. 이전 run record의 unresolved_new_refs는 과거 관측 기록으로 보존하며, 현재 owned-resource cleanup/reconciliation 결과와 별도로 해석한다.

### Protected scope

- Publisher publication semantics와 Operator/Symphony lifecycle
- Task lifecycle 및 active-task admission
- Run-scoped workspace, runtime 및 branch 생성·cleanup의 소유권
- Task/workflow provenance, durable record identity 및 timing evidence
- Repository credentials, repository/base binding, 다른 task의 branch와 PR

이 영역의 동작은 repository-wide branch isolation gate 제거에 필요한 최소 변경을 제외하고 바꾸지 않는다. 다른 task의 ref를 삭제하거나 과거 run record를 재작성하지 않는다.

## Verification

### Admission/finalization regression

- repository-wide branch snapshot/diff로 unrelated 생성·변경·삭제를 unresolved_new_refs, unrelated_changes, unrelated_deletions로 run residue 처리하지 않는지 확인한다.
- legacy run record에 unresolved_new_refs가 있으나 owned resource 및 기존 cleanup action이 정리된 경우 admission이 진행되는지 확인한다.
- 실제 E2E-owned base/delivery branch, workspace 또는 runtime이 남았을 때에는 그 owned residue가 구체적으로 검출되고 admission이 계속 차단되는지 확인한다.
- 다른 task의 remote branch가 변경되거나 삭제되지 않는지 확인한다.

### Representative production E2E

기존 npm run e2e entry point에서 catalog input을 사용해 production Publisher → Operator → Symphony → worker → delivery lifecycle을 실행한다. Durable run record 및 Notion/GitHub readback으로 workload/workflow provenance, lifecycle, owned cleanup, unrelated branch를 gate로 삼지 않은 결과와 실제 PR을 확인한다. Run timing 및 finalization evidence에 기존 정보가 남는지도 확인한다.

## Verification Tools

- **E2E focused tests**: owned/unrelated branch, legacy unresolved_new_refs, cleanup, admission 경계를 확인한다.
- **npm run e2e**: production entry point와 integration 경로를 실행한다.
- **E2E durable run record (operator/e2e/runs/<run-id>/run.json)**: timing, provenance, cleanup, finalization 결과를 authoritative하게 읽는다.
- **Notion 및 GitHub readback**: publication/lifecycle task identity와 실제 delivery PR을 확인한다.
- **Git diff 및 git diff --check**: 변경 경계와 whitespace를 확인한다.
