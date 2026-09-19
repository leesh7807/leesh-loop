# 2026-09-19-production-e2e-harness

## Objective

Leesh Loop의 실제 production 실행 경로를 대표하는 E2E 실행 능력을 구축한다.

E2E는 Notion Publisher로 계획을 게시한 뒤 production Symphony가 실제 워커를 실행하고,
`Ready → In Progress → Human Review → Merging → Done` 경로를 통해 작업을 전달·검토·병합하는
흐름을 대상으로 한다. 워커 실행의 비결정성은 harness가 제어하지 않으며, 성공·실패·정체와
관측 가능한 외부 효과를 evidence로 보존하고 각 run은 유한하게 종료·정리한다.

## Intent

Notion Publisher, Symphony, worker, GitHub delivery, chatgpt-shot review와 Human Review/merge가
연결된 실제 경로를 변경 후 검증할 수 있는 실행 능력이 필요하다. E2E는 Symphony를 단계별
테스트 runner로 바꾸거나 worker에게 E2E 전용 행동을 요구하지 않는다.

각 run은 E2E 전용 Notion task database, run-scoped base branch, run-owned runtime/workspace와
외부 정리 결과를 소유한다. workload catalog에서 작은 조사 작업 하나를 랜덤 선택하여 실제
repository 변경과 `docs/` 조사 결과를 만들고, Publisher가 만든 Accepted Plan이 같은 task의
production tracker representation과 worker input까지 이어지는 binding을 보존한다.

Done에 도달하지 못한 run도 실제로 관측한 범위, 실패 원인, timing, artifact와 검증 공백을
남기고 다음 admission을 안전하게 통과하면 유효한 실행 결과다. Hard cap은 worker에게 보이는
입력이나 production 실패 의미를 바꾸지 않는 harness 종료 경계다.

## Verification Requirements

- 대표 run은 production Notion Publisher, production Operator/Symphony, 실제 workspace/bootstrap,
  Codex worker, chatgpt-shot, GitHub PR/merge와 Notion lifecycle을 사용한다.
- E2E Project의 고정 `project.json`은 일반 production database와 분리된 다음 database URL을
  보존한다: `https://app.notion.com/p/studyleesh/3e08a2658625805cad23fe1137be4a1e?v=3e08a26586258042a8e4000c945e56e7`.
  Publisher, admission, readback과 lifecycle 관측은 이 binding만 사용한다.
- 새 admission은 고정 database를 직접 조회하여 이전 active/dispatchable task, runtime/
  execution ownership과 run-scoped residue가 없음을 확인한 뒤에만 publish한다.
- Publisher task/page identity, Accepted Plan, production `Tracker.Issue.description`과 worker
  input의 연결을 식별 가능한 content evidence로 보존한다. Worker-visible Plan에는 nonce,
  E2E marker 또는 E2E 전용 행동 신호를 추가하지 않는다.
- 각 run은 configured seed source ref를 remote에서 resolve한 immutable seed commit에서
  run-scoped base branch를 만들고, production Project의 `github_base_branch`로 사용한다.
  delivery PR, merge와 Done 확인은 같은 configured base authority를 사용한다.
- run 전후 remote refs와 GitHub-visible PR/base/head/merge 결과를 비교하여 E2E base 외 branch에
  durable 변경이 없음을 확인한다. production surface가 관측하지 못하는 transient mutation은
  없었다고 주장하지 않는다.
- workload catalog는 Accepted Plan과 유한 hard cap을 함께 관리하고 반복 실행에서 후보를
  랜덤 선택한다. catalog metadata와 worker-visible Plan은 분리한다.
- 정상적으로 진행되는 경우 실제 task가 `Ready → In Progress → Human Review → Merging → Done`
  을 관측 가능한 외부 상태와 효과로 진행한다. Human Review → Merging만 E2E Operator가
  normal review, 동일 cycle, 승인된 PR/HEAD와 independent review PASS를 확인한 뒤 기계적으로
  수행한다. blocker, finding, 실패를 성공으로 바꾸거나 다른 PR/HEAD를 선택하지 않는다.
- worker는 실제 repository 작업으로 `docs/` 조사 결과, task branch와 configured base 대상
  delivery PR을 만든다. Merging과 Done은 production worker의 정상 GitHub PR 경로와 remote
  base readback 뒤에만 확인한다.
- Symphony worker, chatgpt-shot, GitHub, Notion의 실제 성공·실패·terminal state·error를
  harness 결과로 재해석하지 않고 run record에 보존한다. chatgpt-shot Job ID, 관측 state,
  terminal result/error와 관측 가능한 duration을 포함한다.
- run 시작·종료, lifecycle 최초 관측 시점, worker runtime/workspace, review job과 주요 외부
  artifact의 timing을 관측 가능한 범위에서 기록한다. authoritative duration이 없으면
  observation timestamp 기반 `observed_duration`만 기록한다.
- hard cap, 관측된 production failure, harness 지속 불가와 정상 Done은 하나의 common
  finalization으로 수렴한다. finalization의 각 external action은 bounded이며 실패·timeout은
  incomplete/unresolved로 남기고 run 자체는 유한하게 끝난다.
- Done 이전 abnormal finalization은 run-owned Symphony를 먼저 정지하고, 이후 task를 다시
  읽어 non-terminal이면 harness가 `Cancelled`로 전환한 뒤 authoritative readback한다. Done
  또는 이미 terminal인 task를 덮어쓰지 않는다.
- terminal 또는 failure run은 workspace, task branch, run-scoped base, local runtime과 다음
  admission을 방해하는 residue를 정리한다. 확인하지 못한 residue는 record에 남기고 admission이
  다시 검증할 때까지 새 dispatch를 막는다.
- destructive resource와 분리된 durable run record에 workload, cap, seed/base, task/page,
  PR/HEAD/merge, lifecycle, worker/review timing, failures, verified-through, verification gaps,
  finalization과 cleanup readback을 남긴다.

## Definitions

**E2E run** — workload 선택부터 production 실행, evidence 수집, terminal/finalization,
run-scoped resource 정리와 다음 admission 확인까지의 한 실행 단위.

**Run record** — workspace와 분리된 durable JSON record. run identity, cap/deadline, lifecycle,
외부 artifact, timing, failure, finalization, cleanup과 검증 공백을 누적한다.

**Run-scoped base** — 해당 run의 production Project가 실제 configured base authority로 사용하는
임시 remote branch.

**Seed source ref / seed commit** — E2E Project에 보존한 remote ref와 매 run remote에서 resolve한
정확한 immutable commit. host의 dirty content는 seed로 사용하지 않는다.

**Workload catalog** — Accepted Plan과 해당 harness metadata를 함께 보존하는 독립 경계.

**Hard cap** — worker input에 포함하지 않는 workload별 유한한 run 종료 한계.

**Observed lifecycle / verified-through** — Notion State와 external effect에서 읽은 실제 진행과
그 증거로 확인된 가장 뒤의 정상 lifecycle 구간.

**Observed duration** — authoritative timestamp/duration 또는 동일 external state의 observation
시점으로 계산 가능한 범위. 내부 compute duration을 뜻하지 않는다.

**Capability** — Notion mutation, Publisher/runtime control, review approval, Git/GitHub inspection
및 cleanup, evidence collection처럼 하나의 외부 조작 책임을 캡슐화한 경계.

**Lifecycle interpreter** — Notion State와 production contract를 읽어 현재 phase와 사용할
capability만 결정하는 경계. 별도의 lifecycle authority를 만들지 않는다.

**Run finalization** — Done 또는 hard cap/failure/지속 불가 조건을 하나의 bounded 순서로
terminal state, evidence flush와 resource cleanup에 수렴시키는 과정.

## Decisions

1. Production Publisher, Operator/Symphony와 worker path는 E2E mode나 단계별 제어 경로 없이
   그대로 실행한다. Harness는 production path 바깥에서 구성·관측·승인·종료만 담당한다.
2. `operator/e2e/project.json`에 E2E database URL과 configurable `seed_source_ref`를 고정한다.
   run마다 이 값을 주입하지 않고 resolved seed/base와 runtime/workspace만 생성한다.
3. run-scoped base 이름은 worker가 E2E 의미를 추론할 수 없는 opaque run identity를 사용한다.
   Accepted Plan, task, branch와 worker environment에 E2E metadata를 추가하지 않는다.
4. catalog entry가 hard cap과 Accepted Plan을 함께 제공하고, 이미 fixed database에 존재하는
   identifier는 재게시 후보에서 제외한다. task/page는 evidence 보존을 위해 삭제하지 않는다.
5. `Ready`, `In Progress`, `Merging`은 관측만 하며, `Human Review`에서는 normal review와
   동일-cycle delivery identity를 독립적으로 확인한 경우에만 Merging을 승인한다. `Rework`와
   blocker는 이번 정상 경로의 범위 밖이므로 production 결과를 재해석하지 않고 finalization한다.
6. evidence는 lifecycle별 특수 저장 절차가 아닌 공통 snapshot 계약으로 축적한다. 관측할 수
   없는 field는 null이며 추정값으로 보정하지 않는다.
7. Symphony 관측 API의 tracker-input read surface는 production tracker adapter가 실제 dispatch
   identity에 대해 구성한 description을 읽기 위한 read-only evidence boundary다. 실행을
   분할하거나 worker 동작을 변경하지 않는다.
8. finalization은 runtime stop → task authoritative reread/필요 시 Cancelled → evidence flush →
   run-owned resource cleanup → branch isolation readback 순서의 bounded/idempotent capability다.
   실패한 action은 이후 action과 evidence flush를 막지 않는다.
9. admission은 durable record만 믿지 않고 fixed Notion database, live runtime ownership,
   remote refs와 unresolved cleanup을 직접 재검증한다. 확인할 수 없으면 publish하지 않는다.
10. run outcome은 Done 여부 하나가 아니라 terminal state, observed failure, verified-through,
    gaps, evidence completeness, finalization completeness와 cleanup 결과의 조합으로 기록한다.

## Verification

### Repository verification

- catalog validation/랜덤 선택/hard cap과 worker-visible Plan 분리를 unit test로 확인한다.
- lifecycle interpreter가 capability만 선택하고 mechanical approval이 blocker, missing delivery,
  다른 HEAD 또는 PASS 아닌 review를 승인하지 않음을 확인한다.
- Notion capability가 fixed database/data-source binding, task/Plan identity, Accepted Plan,
  State와 Workpad readback을 사용하는지 확인한다.
- Evidence snapshot이 Notion, Symphony, tracker input, chatgpt-shot, GitHub와 remote Git을
  같은 schema로 수집하고 unavailable 값을 null/error evidence로 남기는지 확인한다.
- injected capability 기반 orchestration test로 Done과 hard-cap이 같은 finalization 경계로
  수렴하고, mutation 세부 구현이 중앙 orchestration에 들어오지 않는지 확인한다.
- finalization action timeout/failure, Cancelled readback, run-owned branch/workspace safety와
  admission reconciliation을 unit/integration test로 확인한다.
- Symphony observability API의 tracker-input route와 기존 state/issue route를 Elixir test로
  확인한다.

### Representative live E2E

1. fixed database를 직접 조회하고 이전 active/dispatchable task, runtime ownership, residue를
   reconciliation한 뒤 catalog에서 candidate를 랜덤 선택한다.
2. seed source ref와 exact seed commit을 remote에서 resolve하고 run-scoped base를 만들며
   remote readback과 run record를 확인한다.
3. run-owned Operator/Symphony를 production readiness 경로로 시작한다.
4. 선택한 Accepted Plan만 production Notion Publisher로 게시하고 page/Plan/State를 readback한다.
5. 같은 task의 production tracker representation과 tracker-input observability, worker runtime
   identity를 통해 Publisher content가 worker input에 도달했음을 비교한다.
6. 실제 worker가 `docs/` 결과, task branch, run-scoped base 대상 PR을 만든 것을 GitHub와
   Symphony evidence에서 확인한다.
7. chatgpt-shot Job ID, pending/in_progress/terminal result/error와 관측 가능한 timing을
   Workpad, Job readback과 run record에 보존한다.
8. valid normal review만 mechanical approval하여 Merging으로 보내고, 자연스럽게 Done에
   도달한 경우 merged PR/HEAD와 fetched remote base를 authoritative readback한다.
9. Done 또는 legitimate failure 이후 common finalization, cleanup, branch isolation과 record
   durability를 확인한다. Done 이전 구간은 verified-through 이후의 gap으로 남긴다.
10. 다음 admission을 실제로 수행해 이전 run의 terminal task와 cleanup이 새 dispatch를 방해하지
    않음을 확인한다.

### Failure and hard-cap evidence

- review Job이 production 경계에서 failed가 되는 run은 실제 failure, 해당 Job evidence,
  이전 lifecycle/외부 artifact, common finalization과 후속 admission을 보존한다. harness가
  failure를 성공으로 바꾸거나 hard-cap으로 대체하지 않는다.
- worker/외부 상태가 hard cap까지 진전하지 않는 run은 run deadline, cap trigger, runtime stop,
  terminalization/readback, incomplete cleanup과 finalization 종료를 보존한다.
- 어떤 run도 영구 polling, 무한 retry 또는 반복 lifecycle mutation으로 남지 않는다.

## Verification Tools

- `operator/e2e/cli.mjs`: 실제 run/admission 진입점과 durable record 출력.
- Notion Publisher CLI: canonical task/Plan publication.
- `NotionCapability`: fixed database direct admission, task/Plan/State/Workpad readback과 승인/
  Cancelled mutation.
- Operator `leesh-loop.mjs`: production runtime start/stop과 configured base readiness.
- Symphony `/api/v1` observability: runtime, worker/workspace, lifecycle와 production tracker input.
- 실제 `chatgpt-shot submit`/`jobs`: Job identity, state, terminal result/error와 timing.
- Git/GitHub CLI/API: seed/base commit, PR base/head/merge, remote ref isolation과 cleanup.
- run record: 지속 snapshot, finalization action/result, unresolved residue, verified-through와 gaps.
- `npm test`, `mix test`, `git diff --check`: repository regression 및 whitespace 확인.
- representative live run: 계획 게시부터 worker/review/merge 또는 관측된 failure 지점까지의
  intended entry point와 authoritative external readback.
