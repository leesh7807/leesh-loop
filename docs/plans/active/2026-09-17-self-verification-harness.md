# 2026-09-17-self-verification-harness

## Objective

Leesh Loop의 실제 production workflow를 self-verification으로 실행하고, cleanup 이후에도 하나의 durable run identity 아래 어떤 production 경로를 통과했는지, 어디에서 성공·실패·중단됐는지, 그리고 현재 authoritative state가 무엇인지 재구성할 수 있게 한다.

Self-verification은 production execution의 두 번째 authority가 아니다. Tracker state와 Symphony reconciliation이 계속 production lifecycle을 결정하고, harness는 그 실행을 admission·관찰·evidence 수집·안전한 finalization 관점에서 검증한다.

## Definitions

- **Self-verification run**: 하나의 durable run identity로 production workflow를 실제 external effect까지 실행·관찰하는 단위.
- **Admission namespace**: exclusive admission의 stable scope. 이 계획에서는 configured verification tracker database identity다.
- **Admission commit**: exclusive ownership, durable run ID, 다음 invocation이 찾아 resume할 durable run record가 crash-safe하게 함께 확립된 경계.
- **Resumable run**: finalized되지 않은 durable run. runtime·observer 종료만으로 abandoned로 간주하지 않으며 다음 invocation이 authoritative state에서 이어간다.
- **Run-scoped binding**: repository, configured base branch, tracker database로 이루어진 해당 run의 production authority 묶음.
- **Collection disposition**: `complete`, `incomplete`, `irrecoverable collection failure` 중 하나로, production success와 독립적으로 run path 재구성 가능성을 나타낸다.
- **Admission-safe closure**: 다음 run이 시작돼도 이전 task나 execution resource가 다시 dispatch·claim·retry되거나 충돌하지 않는 상태.
- **Run finalized**: admission-safe closure, recoverable collection, final disposition, harness-owned cleanup이 durable하게 확정된 상태. verification success와 같지 않다.

## Intent

실제 production repository/base/tracker binding을 통과하는 bounded investigation을 실행하고, task publish·runtime restart·evidence loss·cleanup 같은 crash boundary에서도 동일 run을 이어간다. Lifecycle evidence는 authority가 아니라 production 경계가 실제로 통과됐는지를 설명하는 durable evidence다.

Production scheduler와 evidence persistence는 분리한다. slow/stalled/crashed evidence writer가 production polling, reconciliation, retry, terminal handling을 unbounded하게 막지 않도록 하고, 그 손실은 collection disposition에 반영한다.

Worker에는 E2E/smoke 목적을 노출하지 않는다. worker는 하나의 bounded subsystem/contract/path를 조사해 Markdown artifact를 만들고, 그것을 실제 commit·push·PR·exact-HEAD independent review·Human Review·production approval·Merging·merge path로 전달한다.

## Decisions

### 1. Seed와 run-scoped binding

- Seed revision은 persistent Project의 configured remote base HEAD이며 local checkout은 authority가 아니다. dirty checkout에서는 새 run을 시작하지 않는다.
- 각 run은 seed에서 temporary base branch를 만들고 persistent verification tracker와 함께 binding을 구성한다.
- admission 이후 temporary base는 해당 run의 effective configured base authority다. Publisher, Operator, Symphony, worker, PR/Rework/Merging/Done verification은 persistent Project의 base를 fallback으로 다시 읽지 않는다.
- Persistent Project configuration은 변경하지 않으며 새 run seed와 stable project identity의 source로만 사용한다.

### 2. Atomic exclusive admission

- namespace는 verification tracker database identity다.
- 같은 namespace의 concurrent invocation은 하나만 새 run을 commit할 수 있다.
- commit 전 interruption은 ownership으로 남지 않아야 하며, commit 후 interruption은 durable run record를 통해 resume한다.
- existing non-finalized run이 있으면 새 run을 만들지 않는다.

### 3. Durable identity와 publish recovery

- durable run record는 run ID, namespace, binding, logical/authoritative task identity, temporary base, runtime ID history, collection disposition, finalization state를 연결한다.
- logical task identity를 publish 전에 저장한다. `logical identity → publish attempted → Tracker task may exist → local binding` crash window에서 resume는 기존 task를 찾거나 idempotent creation으로 수렴하며 duplicate를 만들지 않는다.

### 4. Lifecycle ownership과 finalization

- Harness는 worker를 직접 stop/quiesce/cancel/retry/respawn하지 않고 Tracker lifecycle을 직접 mutate하지 않는다.
- Production workspace cleanup은 Symphony가 소유하고 harness는 workspace를 삭제하지 않는다. temporary base·run/evidence bundle 등 harness-owned resource만 finalization에서 정리한다.
- Published task는 dispatch 가능한 상태로 finalize할 수 없다. execution ownership이 있으면 current authoritative state와 Symphony reconciliation이 그 resource가 더 이상 충돌하지 않음을 확인해야 한다.
- publish 후 readiness/dispatch 장애로 stranded된 task는 immutable task identity와 configured tracker authority를 사용하는 일반 production Operator의 terminal non-dispatchable closure capability를 통해서만 닫는다. active worker/claim/retry ownership이 있으면 우회 종료하지 않는다.
- closure eligibility와 scheduler claim은 production-level에서 경쟁한다. closure가 성공했으면 이후 ownership이 생성되지 않고, scheduler ownership이 먼저 성립하면 closure는 실패해 기존 lifecycle이 계속 소유한다.
- collection complete는 production terminal이나 finalized를 의미하지 않는다.

### 5. Evidence와 recovery

- 최소 evidence boundary는 runtime start, dispatch authorization, candidate/skip/spawn, workspace·agent preparation, Codex/session start, worker exit/stall/blocked, retry/continuation, Tracker polling/reconciliation failure/recovery, Tracker terminal, Symphony terminal observation, teardown, workspace cleanup이다. 정상 poll/hook 전체를 forensic log로 남기지 않는다.
- collection은 event 존재가 아니라 lifecycle evidence·authoritative readback·동일 identity chain으로 필요한 사실을 유일하게 재구성할 수 있는지로 판단한다.
- 특정 Operator/Symphony action의 실제 수행·관찰 자체를 검증하는 경우 해당 direct-observation evidence가 필요하다.
- direct evidence가 영구 소실되어도 current authoritative state가 no live execution, no conflicting ownership, workspace absent, task admission-safe를 결정적으로 증명하면 `irrecoverable collection failure`로 finalize할 수 있다. 이는 historical success를 대신하지 않는다.
- runner deadline은 observer timeout이다. task/worker/runtime/workspace를 변경하지 않고 run은 non-finalized로 남겨 다음 invocation이 resume한다.

### 6. Human Review approval capability

- Human Review → Merging은 일반 production Operator action으로 제공한다. self-verification 전용 endpoint가 아니다.
- action은 immutable task identity와 configured tracker authority로 mutation 전 authoritative State를 읽고, Human Review, delivered PR source HEAD, successful independent review target HEAD를 확인한다.
- exact HEAD equality에서만 approved HEAD를 기록하고 mutation 후 authoritative Merging readback 및 current PR source HEAD 재검증을 수행한다. invalid identity/state/HEAD와 lifecycle 외 approval은 거절한다.
- approval/read와 Merging 사이 PR source HEAD가 바뀌면 기존 approval을 승계하지 않는다. Merging은 mismatch를 확인하면 Rework로 되돌리고 새 HEAD는 production delivery/review/Human Review/approval을 다시 통과해야 한다.
- 정상 성공 identity는 `successful reviewed HEAD = Human Review delivered HEAD = Merging approved HEAD = merged PR source HEAD`다.
- Runner는 Notion State를 직접 mutate하지 않는다.

### 7. Artifact preservation

Workspace, task branch, temporary base가 cleanup된 뒤에도 investigation result를 확인할 수 있도록 durable content 또는 representation을 run/evidence bundle에 보존한다. PR URL이나 report path만 보존하는 것으로는 충분하지 않다.

## Verification

### Deterministic regression coverage

- concurrent atomic admission, commit 전/후 interruption, resume, task publish crash recovery와 duplicate 방지
- published-but-dispatchable task의 unsafe finalization 거부
- stranded task를 production Operator closure로만 terminal non-dispatchable state에 닫은 뒤 authoritative readback 및 finalization
- closure boundary와 scheduler claim의 deterministic race에서 양쪽 ownership/terminal 모순 방지
- run A finalization 후 run B isolation, runtime interruption/restart와 동일 run history attach
- slow/stalled/failed evidence writer가 production polling/reconciliation/retry/terminal handling을 막지 않고 collection gap으로 남는지
- authorization failure, spawn/preparation failure, Codex/session-start 이후 failure, retry, blocked, tracker read/reconciliation failure, terminal, teardown, workspace cleanup의 boundary 재구성
- direct-observation loss와 admission-safe finalization 분리
- Human Review approval의 exact HEAD validation, stale HEAD race, Merging mismatch→Rework, runner direct Notion mutation 부재

### Representative live flow

제공한 persistent Notion DB를 Symphony tracker DB로 사용해 canonical task/Plan schema를 bootstrap하고, configured production repository의 clean remote base에서 temporary base를 만든다. admitted run binding을 readback한 뒤 실제 Operator → Symphony → worker → Codex → Markdown artifact → GitHub PR → exact-HEAD `chatgpt-shot` review → Human Review → production Operator approval → Merging → GitHub merge → configured remote-base readback → Done → Symphony terminal observation → teardown/workspace cleanup → artifact preservation → admission-safe closure → harness cleanup → collection complete → finalized 경로를 통과시킨다.

모든 단계는 run/task/runtime/workspace/artifact/PR/review Job/approved HEAD/merged HEAD/final State/final disposition identity chain으로 연결하고 cleanup 후 durable bundle과 authoritative provider readback으로 확인한다. live capability가 credential/authentication에서 막히면 실제 도달한 경계, blocker, 남은 risk를 기록하고 synthetic success로 대체하지 않는다.

### Verification tools

- `operator/app` self-verification CLI: admission/resume, run-scoped binding, deadline, evidence collection, finalization, harness-owned cleanup
- Operator-owned state root: durable run/evidence bundle과 atomic ownership
- Notion publisher/adapter: canonical issue DB schema, logical/authoritative task identity, State/Plan/Workpad readback
- Production Operator approval/closure: Human Review approval과 stranded task terminal closure의 production mutation
- Symphony runtime/API/lifecycle evidence: current execution, dispatch authorization, reconciliation, terminal observation, teardown/workspace cleanup evidence
- Git/GitHub/`gh`: seed/temporary base, workspace HEAD, PR source/target, merge 및 configured remote-base authority
- `chatgpt-shot` durable Job: independent review authority와 exact target HEAD
- Node/ExUnit tests, live E2E, `git diff --check`: deterministic regression 및 대표 production path 검증

## Execution record

- 구현 브랜치/워크트리: `codex/self-verification-harness-20260917` / `/home/lees/Projects/leesh-loop-self-verification-harness`
- verification tracker: 사용자가 제공한 persistent Notion DB `3df8a265862580cfb1ebda7e3337d9fa`를 실제 Symphony issue DB로 사용했고, Publisher가 canonical task/Plan schema를 bootstrap했다.
- 실제 run: `758db3d0-dac3-43b8-a386-34efd686fda4`
- admission namespace: `notion:3df8a265862580cfb1ebda7e3337d9fa`
- seed readback: remote `main` HEAD `4fa91887af5f458ffd00da21a4873d0488083373`
- run-scoped base readback: `self-verification/758db3d0-dac3-43b8-a386-34efd686fda4`가 seed와 같은 commit으로 생성·확인되었고, runtime config의 effective configured base로 전달되었다.
- authoritative task readback: Notion task `3df8a265-8625-819c-b8b4-dc603674f1aa`, identifier `PLAN-AF94D6810301`, datasource `collection://3df8a265-8625-803d-8c2e-000be8223f0e`.
- live publish observation: 초기 runner가 publisher canonical identifier 대신 run UUID를 logical identity로 넘기는 불일치를 발견했다. 현재 runner는 Plan hash에서 Publisher와 같은 canonical identifier를 사용하고, store는 authoritative publisher identity mismatch를 durable binding 전에 거절한다. 첫 failed run의 bundle에는 이 mismatch와 실제 task identity가 보존되어 있다.
- 실제 도달 경계: atomic admission → durable run → temporary base/tracker binding → task publish → Operator readiness 시작.
- blocker: readiness가 `CHATGPT_AUTH_REQUIRED`로 실패해 Symphony dispatch authorization, worker/Codex, artifact/PR/review/approval/merge/Done 경계에는 도달하지 못했다. 사용자 인증 없이는 이 live flow를 재시도하지 않는다.
- production closure/readback: self-verification 전용 mutation 없이 일반 Production Operator의 stranded closure로 task를 `Cancelled`로 전환했다. Notion authoritative readback은 `Dispatch Fence` 존재, `State=Cancelled`, closure reason, execution ownership 없음이었다.
- finalization/readback: lifecycle evidence에는 admission과 readiness failure가 남았고, `admission_safe=true`, `task_dispatchable=false`, ownership 없음, workspace 없음으로 확인했다. temporary base는 harness cleanup 후 remote에서 absent readback되었고 run bundle은 finalized 및 `collection complete`로 durable하게 남았다. 이는 production workflow 성공을 의미하지 않으며, 인증 blocker를 포함한 실패 경로의 finalization이다.
- artifact preservation 구현: 성공 경로에서는 GitHub PR patch를 run-scoped durable artifact file과 SHA-256 metadata로 보존한다. workspace/task branch/temporary base cleanup 이후에도 result representation을 재확인할 수 있게 했다.
- authority check: Runner/Observer는 worker/Tracker state를 직접 mutate하지 않고, Human Review approval과 stranded closure는 일반 Production Operator capability를 통해서만 수행한다. Lifecycle evidence는 best-effort observer이고 production scheduler authority가 아니다.
- 검증 결과: Node app 전체 40 tests passed; Publisher 26 tests passed; Symphony 전체 333 tests passed, 6 skipped; modified Elixir files format check passed; repository baseline의 unrelated `operator/symphony/lib/symphony_elixir/notion/agent_tool.ex` format drift는 수정하지 않았다; `git diff --check` passed.

## chatgpt-shot review log

- 리뷰한 HEAD: `7f0083feba3f3bb366fec00105798bc9bf9054c1`
- PR: `https://github.com/leesh7807/leesh-loop/pull/33`
- Review Job: `533e1678-7af8-49c6-a016-8fa16fcc7f2e`
- verdict: `FINDINGS`
- finding 수용 근거:
  - admission current-run pointer crash window: 수용. namespace의 `runs/<run-id>/run.json`을 scan해 pointer write 전 중단된 non-finalized run도 resume하도록 수정했다.
  - publisher success 후 local binding crash: 수용. self-verification resume 시 unchanged complete publication을 canonical readback 검증 후 재사용하는 publisher 경로를 추가했다.
  - observer deadline의 polling 지속: 수용. AbortSignal로 observer loop와 Human Review approval 진입을 중단하며 production state는 변경하지 않도록 수정했다.
  - dashboard read 실패 후 unsafe finalization: 수용. dashboard unavailable을 collection gap으로 남기고 authoritative ownership readback이 없으면 finalization을 거부한다.
  - lifecycle evidence cross-run mixing: 수용. 기본 evidence path를 run-scoped로 만들고 ingestion 시 current run ID를 필터링한다.
  - Production Operator stale lock: 수용. owner PID/lock age를 확인해 process crash 후 stale lock을 회수한다.
- 기각 finding: 없음.
- 적용한 커밋: `1334a23` (위 6개 수정과 regression tests)
- 검증 결과: Node app 35 passed, Publisher 26 passed, production-operator/self-verification 집중 검증 16 passed, syntax 및 `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `2999d25e0ad0d5c8d05a76e65233d94375c8dd7c`
- Review Job: `70398be4-de6a-4f27-92cb-e4903035f38f`
- verdict: `FINDINGS`
- finding 수용 근거:
  - independent review Job target HEAD 부재/자기주장 fallback: 수용. authoritative `job.targetHead`가 없으면 approval을 거절하고 delivered HEAD와 exact equality를 검증하도록 수정했다.
  - PASS substring 오인식: 수용. `None.` 또는 명시적 PASS 문서 전체 형식만 승인하고 FINDINGS 본문의 PASS를 거절하도록 수정했다.
  - stranded closure의 task/dashboard Identifier 혼동: 수용. immutable task Identifier를 readback해 CLI/dashboard identity와 일치할 때만 closure를 진행한다.
  - dispatch fence와 scheduler spawn 재검증 race: 수용. Operator와 Symphony가 동일 task Identifier의 coordination lock을 공유하고 lock 안에서 revalidation 후 spawn/terminal transition을 경쟁시킨다.
  - object-valued complete disposition의 늦은 evidence gap: 수용. `{value: 'complete'}`도 gap 발생 시 `incomplete`로 downgrade한다.
  - finalized run 이후 이전 Symphony runtime 잔존: 수용. finalization 전에 active owner 전체를 확인하고 기존 production `leesh-loop stop` lifecycle action 및 owned-state readback을 거친다.
- 기각 finding: 없음.
- 적용한 커밋: `78845ff1e6e92905969c90188bb87b4a1056204a`
- 검증 결과: Node app 40 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, dispatch coordination focused tests 2 passed, syntax/format/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `78845ff1e6e92905969c90188bb87b4a1056204a`
- Review Job: `30e85f0b-a948-45f3-9e33-5b5fb68a2864`
- verdict: `FINDINGS`
- finding 수용 근거:
  - finalized 이전 run의 terminal task 재사용: 수용. run ID marker를 포함한 durable scoped Plan을 만들어 각 run의 canonical task identity를 분리하고 resume 시 scoped Plan SHA를 검증한다.
  - lifecycle evidence writer drop/error의 collection gap 누락: 수용. runtime endpoint가 writer status를 authoritative readback으로 노출하고 runner가 dropped/error를 durable evidence gap으로 기록한다.
- 기각 finding: 없음.
- 적용한 커밋: `116684193f27ad7d0dfcd7521839e87a8802ebc0`
- 검증 결과: 수정 후 새 HEAD에 대해 Node app 40 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` passed. 새 HEAD에 대한 재리뷰가 필요하다.
