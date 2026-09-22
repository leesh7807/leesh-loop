# 2026-09-22-merging-conflict-autonomy

## Objective

`WORKFLOW.md`의 Merging 충돌 정책을 변경해, merge 과정에서 발생한 충돌을 Merging 권한을 가진 worker가 승인된 의미와 범위 안에서 스스로 해소하고 기존 검증을 다시 거쳐 merge를 완료할 수 있게 한다. Merging 권한을 넘어서는 별도 판단이 필요한 경우에는 Human Review blocker로 반환한다.

## Intent

merge conflict 자체를 즉시 human-required blocker로 취급하지 않고, 최신 configured base와 Approved delivery를 통합하는 정상적인 Merging 책임을 허용한다. 충돌 해소로 HEAD가 변경되거나 코드 수정이 발생했다는 사실만으로 재승인을 요구하지 않되, 승인된 제품 의미, externally observable behavior, 계약, 범위 또는 Accepted Plan에서 고정한 접근을 실질적으로 변경하는 별도 결정은 worker가 임의로 내리지 않는다.

검증의 초점은 실제 merge conflict 실행이 아니라, Leesh Loop의 기존 lifecycle 보장과 upstream Symphony의 landing 기준을 비교해 새 계약이 의도한 자율성, 재검증 범위, Human Review 경계, HEAD authority를 정확한 강도로 표현하는지 확인하는 것이다.

## Verification Requirements

1. `WORKFLOW.md`는 merge conflict 자체를 즉시 Human Review blocker로 취급하지 않고 Merging worker의 우선적인 충돌 해소 시도를 허용해야 한다.
2. 충돌 해소 후 applicable repository validation/checks, `git diff --check`, Accepted Plan/Repository Plan final comparison, 기존 Merging merge/readback 검증을 다시 만족해야 한다. Conflict resolution만을 이유로 independent `chatgpt-shot` review gate를 다시 실행하지 않는다.
3. 재검증을 통과하고 merge 가능한 경우 같은 Approved PR과 기존 Done 경로로 진행할 수 있어야 한다.
4. Human Review의 `delivered_head`는 Approved HEAD로 유지한다. 허용된 resolution 후 재검증된 특정 resulting HEAD만 현재 Merging cycle의 Merge target HEAD로 고정하고 merge 및 Done readback을 그 HEAD에 결박한다. 같은 PR의 임의의 later HEAD는 자동으로 승격하지 않는다.
5. 승인된 제품 의미, externally observable behavior, 계약, 범위 또는 Accepted Plan의 고정된 접근을 실질적으로 변경하는 별도 결정이 필요하다고 worker가 판단하면 기존 `reason: blocker` Human Review 경로를 사용해야 한다.
6. 승인된 의미와 범위 안에서 두 변경을 통합하기 위한 구현 선택은 blocker 조건이 아니다.
7. HEAD 변경이나 conflict-resolution commit 자체만으로 재승인을 요구하지 않는다.
8. PR identity, configured-base merge/readback, Done 검증 등 무관한 기존 보장을 약화하지 않는다.

## Definitions

* **Approved delivery**: 바로 앞 Human Review에서 merge가 승인된 PR과 그 delivery.
* **Approved HEAD**: Human Review에 기록된 `delivered_head`; 승인된 delivery의 출발점.
* **Merge target HEAD**: 허용된 conflict resolution과 재검증을 통과한 뒤 현재 Merging cycle에서 실제 merge 대상으로 고정한 resulting HEAD.
* **Merging 권한**: Approved delivery를 configured base에 병합하기 위해 필요한 통합 작업을 수행하고 검증 후 merge를 완료할 권한.
* **충돌 해소**: Approved delivery와 현재 configured base를 통합하기 위한 작업으로, 승인된 의미와 범위 안의 구현 선택 및 재검증을 포함한다.
* **월권에 해당하는 판단**: 충돌 해소를 넘어 승인된 제품 의미, externally observable behavior, 계약, 범위 또는 Accepted Plan의 고정된 접근을 실질적으로 변경하는 별도 결정.

## Decisions

1. merge conflict는 그 자체로 blocker가 아니며, 크기·파일 수·line 수로 자율성 여부를 사전 분류하지 않는다.
2. Human Review의 `delivered_head`는 Approved HEAD로 유지하고 resolution 결과로 덮어쓰지 않는다.
3. resolution 후 요구된 재검증을 통과한 특정 resulting HEAD를 기존 Merging evidence에서 Merge target HEAD로 기록한다. 새 lifecycle state나 별도 workflow는 만들지 않는다.
4. Merge target HEAD 고정 후 같은 PR의 불일치 later HEAD는 자동 merge 대상이 아니다.
5. conflict resolution만으로 independent `chatgpt-shot` code/structural review를 다시 요구하지 않는다. 별도 제품·계약·범위 결정을 요구하는 경우에는 blocker로 반환한다.
6. 기존 Approved PR identity, normal PR merge path, configured-base readback, Done 조건, Human Review 승인 및 Rework 정책은 변경하지 않는다.
7. protected scope는 `WORKFLOW.md`의 Merging conflict 처리 계약이다. Publisher/Operator/Symphony 구현, `docs/WORKFLOW_TEMPLATE.md`, Rework 정책, independent review 정책, Human Review 승인 방식은 변경하지 않는다.

## Verification

* 변경 전후 `WORKFLOW.md`를 비교해 `conflict 발생 → 해소 시도 → 기존 검증 재수행 → Merge target HEAD 고정 → 같은 Approved PR merge → 해당 HEAD에 결박된 Done readback` 흐름과 월권 판단 시 blocker 분기가 문서상 성립하는지 확인한다.
* Approved HEAD와 Merge target HEAD의 authority chain, 동일 PR의 임의 later HEAD 차단, 새 lifecycle state 부재를 확인한다.
* 재검증 범위에 repository checks, `git diff --check`, Plan comparison, 기존 Merging PR/merge/readback 검증만 포함되고 conflict만으로 independent review가 재실행되지 않는지 확인한다.
* Leesh Loop 주변 lifecycle 계약 및 upstream Symphony의 현재 `elixir/WORKFLOW.md`, `.codex/skills/land/SKILL.md`와 문장 강도를 비교한다.
* 실제 merge conflict 또는 production Merging 실행은 수행하지 않는다.
* 사용자의 명시적 지시에 따라 structural review는 수행하지 않는다. 지정 PR과 정확한 HEAD에 대해 `chatgpt-shot` code review만 수행한다.

## Verification Tools

* 현재 `WORKFLOW.md`: 기존 Merging lifecycle, blocker, HEAD, merge, Done 계약.
* upstream `openai/symphony` `elixir/WORKFLOW.md`: worker가 Merging/landing을 수행하는 workflow 기준.
* upstream `.codex/skills/land/SKILL.md`: conflict resolution, checks 재수행, landing 및 ambiguity 처리 기준.
* Git diff 및 문서 비교: 상충 문구와 변경 범위를 확인.
* `chatgpt-shot submit` / `chatgpt-shot jobs`: 지정 PR/HEAD의 실제 diff에 대한 code review.

## chatgpt-shot review log

* 아직 리뷰하지 않음.
