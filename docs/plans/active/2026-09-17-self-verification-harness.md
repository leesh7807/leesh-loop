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
- 검증 결과: Node app 전체 44 tests passed; Publisher 26 tests passed; Symphony 전체 333 tests passed, 6 skipped; modified Elixir files format check passed; repository baseline의 unrelated `operator/symphony/lib/symphony_elixir/notion/agent_tool.ex` format drift는 수정하지 않았다; `git diff --check` passed.

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

- 리뷰한 HEAD: `b1211284b889b750944607f32b931bccc445e6ba`
- Review Job: `5e107f7e-5a4e-4b59-a21f-14807cd74b34`
- verdict: `FINDINGS`
- finding 수용 근거:
  - namespace 공용 scoped Plan 재사용으로 finalized task가 다음 run에 상속됨: 수용. scoped Plan을 run record 디렉터리에 저장해 run마다 marker/Identifier가 분리되고 resume은 해당 run 파일만 읽도록 수정했다.
  - malformed lifecycle evidence가 recoverable incomplete로 영구 admission lock을 만듦: 수용. malformed NDJSON gap을 irrecoverable로 기록해 admission-safe closure 후 irrecoverable collection failure로 finalize할 수 있게 했다.
- 기각 finding: 없음.
- 적용한 커밋: `2bc2616fcac0e62d746c2b61eb732b0d4d7d0fb5`
- 검증 결과: Node app 40 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `bdbda228c557fcd95a3c0e74bcb208dbc5794162`
- Review Job: `31d944de-08d7-4f1f-b173-ae3fb2036aab`
- verdict: `FINDINGS`
- finding 수용 근거:
  - cleanup 완료와 finalized 기록 사이 crash 후 temporary base 재생성: 수용. destructive harness cleanup 전에 `finalization.phase=cleanup_started`를 durable하게 기록하고, 다음 invocation은 일반 execution을 재시작하지 않고 cleanup finalization recovery를 수행하도록 수정했다.
- 기각 finding: 없음.
- 적용한 커밋: `c239824dbd9fa5674381e66c9499db0c292febc8`
- 검증 결과: Node app 41 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, cleanup interruption regression 및 format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `4e44e59ca4f025eb193db88419fbd8bd18719698`
- Review Job: `31d944de-08d7-4f1f-b173-ae3fb2036aab`
- verdict: `FINDINGS`
- finding 수용 근거:
  - Rework 이후 최초 Human Review delivery를 자동 승인/artifact로 재사용: 수용. append-only Workpad에서 최신 `Human Review` block만 선택해 current cycle의 PR/HEAD/Job identity를 사용하도록 공통화했다.
  - durable admission record 전 remote temporary base 생성: 수용. admission은 먼저 pending run binding과 run ID를 durable하게 기록하고, branch materialization은 idempotent 재시도 가능한 후속 단계로 분리했다.
- 기각 finding: 없음.
- 적용한 커밋: `b7b2842c76d17d98812eb6506bc2033a14ced2d1`
- 검증 결과: Node app 42 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, latest Human Review cycle regression 및 format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `63249a3c7e6fe9942e6ef64c843157c2faeed44a`
- Review Job: `167c542b-a857-47c5-8731-4735e60e5ad5`
- verdict: `FINDINGS`
- finding 수용 근거:
  - terminal resumable run이 finalization 전에 readiness를 다시 요구: 수용. resumed authoritative task가 이미 `Done`/`Cancelled`이면 runtime을 다시 시작하지 않고 authoritative readback과 finalization recovery로 바로 진입한다.
  - 일반 `close-stranded` CLI의 coordination lock 미설정: 수용. CLI가 project config 또는 명시적 coordination root를 통해 Symphony와 같은 lock path를 결정하고, 어느 경로도 없으면 안전하게 거절한다.
- 기각 finding: 없음.
- 적용한 커밋: `64aac1a8ed7e25dae4f395ffeaa61b926d09b792`
- 검증 결과: Node app 42 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `f2ea07a3b00ffa911511af0e4de844d56307ab68`
- Review Job: `c56fd59e-6d0a-4905-b727-0a5d52a1cf7d`
- verdict: `FINDINGS`
- finding 수용 근거:
  - cleanup 중 새 collection gap이 pre-cleanup `complete`로 덮어써짐: 수용. cleanup 후 현재 run을 다시 읽고 새 gap/irrecoverable 상태를 반영한 disposition만 finalization에 기록한다.
  - Merging이 Approved PR identity를 검증하지 않음: 수용. durable `Approved PR`과 현재 Merging 호출의 PR identity가 exact match일 때만 HEAD 검증을 진행한다.
- 기각 finding: 없음.
- 적용한 커밋: `2f4aad6efdc6fd4bac77ceab535db59c50e2ecaf`
- 검증 결과: Node app 44 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, cleanup-gap/alternate-PR regression 및 format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `3cc52c14b358070d4b3e9c79128900738ae9e05f`
- Review Job: `e0fa5e9c-2b65-4e36-b609-7be218dfe088`
- verdict: `FINDINGS`
- finding 수용 근거:
  - terminal run이 runtime crash 후 Symphony teardown/workspace cleanup을 복구하지 못함: 수용. terminal resume 시 runtime state 또는 task workspace가 남아 있으면 정상 Operator start 경로로 runtime을 재기동해 Symphony-owned cleanup을 수행한 뒤 finalize한다.
- 기각 finding: 없음.
- 적용한 커밋: `18099e1d52608327c38f6768c4b93041cc1f0697`
- 검증 결과: Node app 44 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `8c60f7c27ad82991769b2672fa1ca0c584de27fd`
- Review Job: `76d935d8-e13c-49e7-b422-5efcf03a3c0d`
- verdict: `FINDINGS`
- finding 수용 근거:
  - terminal recovery가 dispatch acknowledgement만 기다려 workspace cleanup보다 먼저 finalize함: 수용. 재기동 후 workspace 부재를 bounded wait로 확인하고, timeout에는 normal Operator stop/readback 후 non-finalized로 남긴다.
- 기각 finding: 없음.
- 적용한 커밋: `a5baf2ef9cc9d39ee3cd5d5881f104f4fab08cd`
- 검증 결과: Node app 44 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `ac3a9e65c8a42ee441964dad24934f929c6acffb`
- Review Job: `865d6407-a16a-4207-960b-b0a49ef1fe7d`
- verdict: `PASS`
- finding 수용 근거: 없음.
- 기각 finding: 없음. `None.`
- 적용한 커밋: 없음.
- 검증 결과: 지정 HEAD의 실제 원문 기준 finding 없음. 해당 HEAD의 로컬 검증은 이전 라운드에서 Node app 44 passed, Publisher 26 passed, Symphony 333 passed/6 skipped, format/syntax/`git diff --check` 통과를 확인했다.

- 리뷰한 HEAD: `5faba6fb51aa4d29d622fc10e6e47639fb37bf43`
- Review Job: `0fad128b-b2a5-4e36-9a6d-edeee3e3c33d`
- verdict: `FINDINGS`
- finding 수용 근거:
  - stale dispatch lock 복구가 unlink 후 재생성하는 TOCTOU로 scheduler와 stranded closure를 동시에 통과시킬 수 있음: 수용. Elixir와 Production Operator의 공유 dispatch lock 모두 stale 경로를 동일 디렉터리의 고유 reclaim 경로로 먼저 atomic rename한 뒤 원자 경계 밖에서 재획득하도록 변경했고, 다른 contender가 먼저 rename한 경우 새 owner를 다시 관찰하도록 했다.
- 기각 finding: 없음.
- 적용한 커밋: `70c6ad0c0a06ab75bba20a8ae1a1955870fc1c23`
- 검증 결과: Production Operator 10 passed, Node app 전체 45 passed, Symphony 333 passed/6 skipped, Elixir format check, syntax check, `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `b7e3194ffa503248a8c86d57883a6d402548b72e`
- Review Job: `c26ecbc3-676b-4086-9f29-7c7a9df8e6ea`
- verdict: `FINDINGS`
- finding 수용 근거:
  - stale admission lock 복구가 새 소유자의 lock을 삭제할 수 있음: 수용. SelfVerification admission lock도 stale directory를 고유 reclaim 경로로 atomic rename한 뒤 제거하고 재획득하도록 변경했으며, 두 별도 프로세스의 stale-lock 동시 복구 회귀 테스트를 추가했다.
- 기각 finding: 없음.
- 적용한 커밋: `fd986b04d0f12b0862e985556445e5f04fcc90fa`
- 검증 결과: Node app 전체 46 passed, stale admission lock 동시 복구 회귀를 포함한 self-verification 15 passed, `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `8832c9488b9f8011e4b26d76e155984220c605c6`
- Review Job: `f419b32f-84fa-4566-b51a-05c3e9cca5e4`
- verdict: `FINDINGS`
- finding 수용 근거:
  - owner metadata 기록 전 100ms stale 판정으로 살아 있는 lock을 reclaim할 수 있음: 수용. SelfVerification, Production Operator task/dispatch lock, Elixir dispatch lock을 공통적으로 완성·fsync한 candidate를 hard-link로 no-replace publish하도록 변경해 공개 lock path에는 완전한 owner record만 나타나게 했다. 기존 directory marker는 migration/recovery 대상으로 atomic rename 처리한다.
- 기각 finding: 없음.
- 적용한 커밋: `f828dfce11d41af822d71208efd14f3be91f141c`
- 검증 결과: Node app 전체 46 passed, Symphony 333 passed/6 skipped, Node syntax, Elixir format, `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `3ec70a8038f1c185da387efce58f7e5923ac8168`
- Review Job: `b6600dd5-4c48-4bde-bad7-7b0488eb7a7a`
- verdict: `FINDINGS`
- finding 수용 근거:
  - stale lock 회수가 새 소유자의 lock을 제거할 수 있음: 수용. reclaim이 관찰한 owner raw content를 atomic rename 후 재확인하고, identity가 바뀌었으면 no-replace hard-link로 새 lock을 복구한 뒤에만 이전 inode를 제거하도록 수정했다. 각 새 owner에는 고유 `lock_id`를 추가했다.
- 기각 finding: 없음.
- 적용한 커밋: `0f8e018a0da17bf23148b8f2dc52a12c057540d5`
- 검증 결과: Node app 전체 46 passed, Symphony 333 passed/6 skipped, Node syntax, Elixir format, `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `521c25a5cd7fe51d861cb53bbfbad3491ee4752f`
- Review Job: `df184e6b-e3df-4b08-8698-c3fa5ebfe80e`
- verdict: `FINDINGS`
- finding 수용 근거:
  - stale lock 복원 중 제3의 owner가 진입하면 기존 holder와 동시에 실행할 수 있음: 수용. pathname 기반 stale reclaim/복원 자체를 제거하고, Node와 Elixir가 동일한 Linux kernel `flock` lock을 non-blocking으로 획득하도록 전환했다. 프로세스 crash/stop 시 kernel이 lock을 자동 해제하므로 stale owner 판정과 복원 race가 사라진다.
- 기각 finding: 없음.
- 적용한 커밋: `01e6fa826d20b77c889dc474caa55ebe25885d53`
- 검증 결과: Node app 전체 46 passed, Symphony 333 passed/6 skipped, Node syntax, Elixir format, `git diff --check` passed. 수정 후 현재 HEAD에 대한 재리뷰가 필요하다.

- 리뷰한 HEAD: `1eb5320d2db4007a0396c33f41d4590def64f1f4`
- Review Job: `40157ec4-dc47-4612-aa4d-bcbd76a100be`
- verdict: `PASS` (`None.`)
- finding 수용 근거: 없음.
- 기각 finding: 없음. 지정 HEAD 원문 기준 실제 결함이 없음을 확인했다.
- 적용한 커밋: 없음.
- 검증 결과: 지정 HEAD 기준 `chatgpt-shot`이 `None.`을 반환했다. 해당 HEAD의 로컬 검증은 Node app 46 passed, Symphony 333 passed/6 skipped, Node syntax, Elixir format, `git diff --check` 통과다.
