# 2026-09-20-e2e-mechanical-human-review-transition

## Objective

E2E의 `Human Review` 처리를 production semantics의 판정자가 아니라 사람의 상태 변경 동작을 모사하는 기계적 runner로 제한한다. 최초 authoritative `Human Review` 관측 시 Workpad/review 의미를 해석하지 않고 `Merging`으로 전환하며, production `Merging`이 다시 `Human Review`를 반환하면 재승인하지 않고 `Cancelled`로 종료한다.

정상 경로와 실제 repository 상태 불일치로 production이 Human Review로 복귀하는 blocker 경로를 representative live E2E로 검증한다.

## Scope and decisions

- 최초 `Human Review → Merging` 조건은 authoritative State와 해당 run에서 아직 mechanical transition을 수행하지 않았다는 E2E 실행 기록뿐이다.
- E2E는 `reason`, Human Review cycle, delivered PR/HEAD, review target, Job ID/cycle 연결, Job terminal state, `PASS`, 승인 가능성을 해석하지 않는다.
- mechanical transition 성공 후 run-local flag를 기록하고, 이후 `Human Review`는 production evidence를 보존한 뒤 `Cancelled`로 전환하고 authoritative readback한다.
- production Merging worker의 approved delivery, PR/base/HEAD 검증, merge/recovery, blocker handoff, `Done` 판단은 변경하지 않는다.
- E2E의 lifecycle 관측, evidence 수집, Plan binding, timeout, Done/repository 결과 검증은 유지하되 production merge authorization으로 사용하지 않는다.
- Done 검증은 E2E가 만든 `approved_delivery`가 아니라 run-owned delivery PR과 실제 GitHub merge/configured-base readback evidence를 사용한다.
- blocker live verification은 최초 Human Review 직후 run-owned delivery source branch HEAD만 외부에서 한 번 전진시키고, GitHub authoritative readback 후 추가 개입 없이 기존 flow를 계속한다. timing race 실패 시 최대 한 번만 새 live run으로 재시도하며, 두 번 모두 실패하면 미검증으로 기록하고 runtime에 test-specific synchronization/fault injection을 추가하지 않는다.

## Verification requirements

1. 서로 다른/불완전한 Workpad와 review evidence에서도 최초 Human Review가 동일하게 Merging mutation을 수행한다.
2. 재진입 Human Review에서는 Merging을 재호출하지 않고 evidence를 보존한 채 Cancelled mutation 및 authoritative readback으로 종료한다.
3. production Merging ownership tests가 approved delivery와 repository mismatch blocker handoff를 계속 검증한다.
4. 정상 live flow에서 `Human Review → Merging → production merge/verification → Done`을 실제 Operator, Notion, Symphony, production worker, GitHub로 관측한다.
5. blocker live flow에서 `Human Review → external HEAD perturbation → Merging → production Merging → Human Review → Cancelled`와 변경 전후 source HEAD, branch/PR identity, GitHub readback, lifecycle/evidence를 관측한다.
6. 변경된 E2E 범위에 Workpad/review 문자열을 승인 또는 blocker 분류로 변환하는 중복 production semantics가 남지 않았음을 search와 focused tests로 확인한다.

## Verification limits

Focused tests and repository tests support the boundary but do not substitute for live verification. Live success/blocker execution requires the configured external Operator, Notion, Symphony, production worker, GitHub, credentials, and a representative workload; unavailable access or a two-attempt timing miss must be recorded as an explicit verification gap.
