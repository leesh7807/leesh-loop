# 2026-09-22-e2e-run-input-and-nested-runtime

## Objective

E2E run이 고정된 workload와 production workflow에 묶이지 않고, 실행마다 확정한 Accepted Plan과
E2E workflow를 기존 Publisher → Operator → Symphony → Codex worker production 경로로 실행하게
한다. Workload, workflow, hard cap, runtime option과 filesystem/sandbox 조건을 run 이후에도
재구성할 수 있는 durable evidence로 보존하고, Symphony/Codex worker sandbox 안의 nested run도
실제 workload execution까지 진행하게 한다.

## Intent

별도 workload 입력이 없으면 catalog random과 기존 catalog-only run-specific H1 materialization을
유지한다. 특정 작업은 catalog id selector가 아니라 Accepted Plan 원문을 직접 공급한다. Provided
Plan은 UTF-8 non-empty 문서이면 사용하며 H1, suffix, frontmatter 또는 semantic schema를 요구하거나
수정하지 않는다. 동일 content-derived publication이 이미 completed 상태이면 production Publisher의
duplicate failure를 그대로 보존한다.

Workflow는 기본적으로 `operator/e2e/WORKFLOW.md`를 사용하고, 필요하면 `--workflow`로 한 run의
원문 문서를 공급한다. 기본 workflow는 production workflow의 tracker, lifecycle, repository/base,
workspace bootstrap과 Codex 실행 의미를 유지하되 기본 E2E에 불필요한 외부 review-service worker
의존성을 제거한다. Provided workflow도 E2E가 merge, patch, 정규화 또는 fallback하지 않는다.

Nested Symphony workspace는 현재 writable repository/workspace 내부의 run-owned root에 둔다.
System temporary directory 사용은 E2E 전용 우회가 아니라 Symphony default Codex sandbox policy가
허용해야 한다. 기존 dedicated Notion database, run-scoped base, authoritative Publisher readback,
lifecycle, finalization, cleanup, admission reconciliation과 branch isolation 책임은 유지한다.

## Verification Requirements

1. 기본 run은 catalog random 후보를 선택하고 선택된 entry의 hard cap과 catalog-only H1
   materialization 결과를 기존 production 경로로 실행한다.
2. `--plan PATH`는 catalog 선택 없이 supplied 원문을 Publisher에 전달하며, 기본 hard cap은
   `1,800,000ms`, `--hard-cap-ms`는 finite positive override이다.
3. Provided Plan duplicate publication은 E2E mutation, alternate identity, completed task 재사용
   또는 fallback 없이 Publisher failure와 finalization evidence로 남는다.
4. `--workflow PATH`는 UTF-8 원문을 resolve 시점에 한 번 확정하여 그대로 사용하고, runtime
   failure는 다른 workflow로 바꾸지 않는다.
5. admitted run의 record와 snapshot에는 workload source/provenance, Publisher Plan 원문/hash,
   catalog materialization 전후 또는 provided pass-through, resolved cap/provenance, workflow
   원문/hash/source, `skip_external_readiness`를 포함한 runtime options, 실제 Operator Project,
   nested workspace root와 적용 가능한 sandbox/runtime 조건이 남는다.
6. Provided Plan/workflow path 또는 hard cap을 input으로 구성할 수 없으면 production execution을
   시작하지 않는다. 읽을 수 있는 입력의 semantic validity와 duplicate 판단은 production
   consumer가 소유한다.
7. nested workspace는 current repository 내부에 있고 host-global workspace/OS temp를 authority로
   사용하지 않는다. Symphony default Codex policy는 worker workspace, `.git`, network와 approval
   의미를 보존하면서 Linux system temporary directory를 실제 사용할 수 있게 한다.
8. finalization은 nested runtime/destructive workspace state를 cleanup하고 run record, Plan/workflow
   snapshots, lifecycle/failure evidence를 보존한다. 기존 admission, lifecycle, cleanup, branch
   isolation 계약은 회귀하지 않는다.

## Definitions

* **Catalog random workload**: `--plan`이 없을 때 catalog에서 선택되는 workload.
* **Provided workload**: `--plan`으로 직접 공급한 Accepted Plan과 resolved hard cap.
* **Resolved workflow**: production runtime 시작 전에 default 또는 provided source에서 읽어 snapshot한
  workflow 원문.
* **Run input**: workload, resolved workflow, hard cap과 E2E runtime options의 한 번 확정된 집합.
* **Nested Symphony workspace root**: run-local Operator Project의 `symphony_workspace_root`가
  가리키는 repository 내부 root.

## Decisions

1. Workload source는 catalog random과 provided 두 가지뿐이며 catalog id selector를 추가하지 않는다.
2. Catalog workload에만 기존 H1 execution suffix materialization을 적용한다. Provided 원문은
   Publisher에 전달할 때까지 byte-level 입력 의미를 변경하지 않는다.
3. Provided hard cap은 명시 override 또는 30분 기본값을 사용하고, catalog hard cap은 catalog entry가
   authority이다. Resolved cap은 deadline과 finalization 판단에 사용한다.
4. Default workflow는 repository-owned 파일로 저장하고 provided workflow는 별도 E2E policy와
   merge하지 않는다. Workflow source는 run 중 reload하지 않는다.
5. Snapshot과 hash는 destructive nested workspace와 분리된 run directory 및 `run.json`에 함께 보존한다.
6. E2E nested workspace placement를 위해 Operator Project가 명시적으로 repository 내부 root를
   허용할 수 있게 하되, 일반 production Project의 repository 밖 workspace 기본 계약은 유지한다.
7. Symphony default Codex sandbox policy에 system temporary directory를 추가 허용한다. Explicit
   provided workflow policy는 pass-through하고 이번 범위에서 재설계하지 않는다.
8. production Publisher, Operator startup, Symphony dispatch, worker execution, lifecycle observation과
   finalization에는 workload/workflow source별 별도 실행 경로를 만들지 않는다.

## Verification

* Node E2E tests로 input resolution, H1 없는 provided Plan, duplicate preservation, cap default/override,
  catalog materialization progression, workflow pass-through, evidence persistence와 workspace placement를
  확인한다.
* Operator tests로 nested repository workspace의 명시적 허용과 기존 external-readiness 기본 거부를
  확인한다.
* Symphony tests로 default `workspaceWrite` payload의 worker workspace, `.git`, network, approval와
  system temporary directory 조건을 확인한다.
* `node operator/e2e/cli.mjs run operator/e2e/project.json`을 대표 entry point로 사용하고,
  authoritative Notion readback, lifecycle, finalization과 `run.json` snapshot/hash를 확인한다.
* 가능한 환경에서 `--plan`, `--hard-cap-ms`, `--workflow`와 nested worker sandbox를 실제 실행한다.
  현재 환경에서 직접 live external E2E 또는 Mix dependency가 unavailable하면 그 정확한 surface와
  남은 risk를 closeout에 기록하고 lower-level test를 대체 증거라고 주장하지 않는다.

## Verification Tools

* `node operator/e2e/cli.mjs run operator/e2e/project.json`
* `node --test operator/e2e/test/*.test.mjs operator/app/test/*.test.mjs`
* `mix test` in `operator/symphony`
* production Notion Publisher tests and authoritative Notion task readback
* `operator/e2e/runs/<run-id>/run.json` 및 workload/workflow snapshots
* filesystem/process observation for nested workspace and Linux system temporary-directory access

## chatgpt-shot review log

- Round 1 — review target `https://github.com/leesh7807/leesh-loop/pull/50`, reviewed HEAD
  `0c6e5a2e2ce2b0b483609d1d702faa737e0c5b3b`; verdict `BLOCKED`. `chatgpt-shot submit`가 Job ID
  반환 전에 `CHATGPT_AUTH_REQUIRED`로 실패했으며 인증/로그인은 수행하지 않았다. 리뷰 finding은
  확정하지 않았고 수정/재리뷰 커밋은 없다. 적용 커밋은 `0c6e5a2e2ce2b0b483609d1d702faa737e0c5b3b`이다.
  로컬 검증은 E2E Node 44개, Operator Node 24개, Notion Publisher 27개, `mix format
  --check-formatted`, `git diff --check` 통과. `mix test`는 환경의 missing `ssl.app`, live E2E/admit는
  missing `NOTION_TOKEN`으로 각각 실행하지 못했다.

- Round 2 — reviewed HEAD `066a8cebbedf36f69e6cb47cc5e77f6c585de00e`; verdict `FINDINGS`.
  H1 없는 provided Plan이 input resolution에서는 허용되지만 default E2E workflow가 공유 template의
  H1 identity blocker를 그대로 적용해 worker 실행을 중단시키는 finding을 수용했다. E2E workflow에
  provided workload 예외를 명시하고 회귀 테스트를 추가한 `a07eb54`를 적용했다. E2E Node 45개,
  Operator Node 24개, Notion Publisher 27개와 `git diff --check`가 통과했다.

- Round 3 — reviewed HEAD `a6cab5dd384e40ed9155822fc0d07d2b32f36588`; verdict `FINDINGS`.
  Provided workflow의 explicit `codex.turn_sandbox_policy`를 Symphony가 적용해도 runner가 default
  sandbox와 system temporary-directory 허용으로 evidence를 기록하던 finding을 수용했다. 실제
  workflow provenance에 맞는 runtime evidence와 회귀 테스트를 추가한 `fa66c12`를 적용했다.
  E2E Node 46개와 `git diff --check`가 통과했다.
