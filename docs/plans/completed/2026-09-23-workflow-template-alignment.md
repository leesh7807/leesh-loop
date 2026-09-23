# 2026-09-23-workflow-template-alignment

## Objective

`docs/WORKFLOW_TEMPLATE.md`를 현재 `WORKFLOW.md`에서 확립된 재사용 가능한 Plan-based worker policy에 맞춘다. 다른 저장소가 이를 기반으로 자체 `WORKFLOW.md`를 구성할 때 공통 lifecycle과 실행 정책을 이어받을 수 있게 한다.

## Intent

Template은 2026-09-14 이후 갱신되지 않았고, 현재 workflow에는 configured base, Merging, 승인된 delivery와 merge target, conflict resolution, 실제 delivery 완료 의미가 추가되었다. Template은 minimum policy 역할과 현재 문서 수준의 간결함을 유지하며, repository-specific 세부사항은 concrete workflow에 남긴다.

## Verification Requirements

- 재사용 가능한 configured repository/base 정책과 continuation, Rework, Merging, terminal lifecycle 의미가 template에 반영되어야 한다.
- 오래된 `origin/main` 기준은 없어야 하며 template과 configured-base 정책이 충돌하지 않아야 한다.
- Notion, Operator, `chatgpt-shot`, 구체 GitHub 명령, validation, model/runtime 설정 등 repository-specific 세부사항이 공통 정책으로 들어오지 않아야 한다.
- Template은 현재 `WORKFLOW.md`와 비슷하게 직접적이고 간결해야 하며, 같은 의미를 반복하거나 상세 specification으로 확장하지 않아야 한다.
- Accepted Plan, Repository Plan, Workpad, continuation, Human Review의 기존 역할과 의미를 보존해야 한다.

## Definitions

- **Reusable template**: `docs/WORKFLOW_TEMPLATE.md`; 여러 저장소에서 공유할 worker policy.
- **Concrete workflow**: 각 저장소의 `WORKFLOW.md`; 공통 policy에 repository-specific configuration과 execution detail을 더한다.
- **Configured base**: concrete workflow 또는 runtime configuration이 작업 대상으로 지정한 base branch.
- **Approved delivery**: Human Review 이후 Merging 대상으로 승인된 delivery.
- **Merge target**: Merging에서 실제 merge 대상으로 확정된 HEAD.

## Decisions

- 기존 minimum Plan-based policy의 범위를 유지하고 concrete workflow 전체를 일반화해 복제하지 않는다.
- `origin/main` 고정 표현을 configured base에 대한 일반 정책으로 바꾼다. 새로운 implementation과 Rework는 명시적으로 configured된 repository/base를 기준으로 하며, checkout, default branch, fallback에서 이를 추론하지 않는다.
- Human Review 뒤 `In Progress`는 기존 workspace와 approach를 이어가고, `Rework`는 이전 implementation basis를 폐기해 fresh configured base에서 시작한다. `Merging`은 Human Review에서 승인된 delivery만 이어받으며 conflict resolution은 승인된 의미, 범위, Accepted Plan 접근 안에서 수행한다.
- 승인된 delivery identity와 merge target을 구분한다. Conflict resolution이 새 HEAD를 만들 수 있으나 이는 새 승인 delivery가 아니다. Terminal 완료는 실제 merge와 configured base의 확인 이후로 둔다.
- 기존 섹션을 수정해 반영한다. marker block, 세부 merge 절차, 새 heading/개념 계층을 추가하지 않는다.
- `WORKFLOW.md` production policy와 Operator, Symphony, Publisher, E2E, `chatgpt-shot` 동작은 변경하지 않는다.

## Verification

- Template 갱신 전후와 2026-09-14 이후 `WORKFLOW.md` 변경을 비교해 reusable 정책을 확인한다.
- Template 전체를 읽고 오래된 base 표현, concrete-only 세부사항, 중복·장황한 설명, 기존 역할의 의미 변화를 점검한다.
- `git diff --check`를 실행한다.

## Verification Tools

- Git history/diff: template 기준 시점 이후 workflow 정책 변화와 수정 범위를 확인한다.
- `rg`: stale base 표현과 repository-specific 세부사항을 검색한다.
- `WORKFLOW.md` 및 최종 template 읽기: lifecycle 의미, 용어, 밀도를 비교한다.
- `git diff --check`: whitespace 오류를 확인한다.

## chatgpt-shot review log

- **Round 1 — reviewed HEAD:** `e524757ffa748ebfca0712db900a90503f030b83` — Job `d6d5174b-9564-4098-8c35-34c15dd59563` — `FINDINGS`.
- **Accepted:** `docs/WORKFLOW_TEMPLATE.md:35` generalized Review Input creation to every active state, conflicting with the concrete lifecycle where `Merging` consumes no Review Input. Scoped creation to the `In Progress` and `Rework` paths, matching the reachable Human Review returns and current `WORKFLOW.md` contract.
- **Fix commit:** `194afebf0c9b1cf1796a899856172c545f512814`.
- **Verification:** confirmed PR and local HEAD matched the reviewed SHA; compared the template return path against `WORKFLOW.md:148`; `git diff --check` passed after the fix.
- **Round 2 — reviewed HEAD:** `372bdf8c7f0f4f5f9120027ef6da87cb0ccc8493` — Job `0d83d991-c419-4644-9e87-b69bff815976` — `PASS`, `# Findings: None.`
- **Disposition:** no remaining finding to accept or reject. The Round 1 correction is present at the reviewed HEAD.
- **Verification:** PR and local HEAD matched at review; final template read, stale/config/tool search, and `git diff origin/main..HEAD --check` passed.
