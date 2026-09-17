# 2026-09-17-notion-task-surface-adjustments

## Objective

Leesh Loop의 기존 Notion task surface와 workflow를 크게 확장하지 않고 다음 세 가지 운영상 불편과 데이터 손실을 함께 정리한다.

* `Backlog`를 실행 전 작업을 보관할 수 있는 정상적인 비활성 workflow state로 지원한다.
* 작업에서 생성된 delivery PR을 Workpad에서 바로 열 수 있는 링크로 남긴다.
* Plan을 Notion에 publish할 때 원문의 Unicode 문자가 HTML numeric entity로 변형되거나 `�`로 손실되지 않도록 한다.

현재 full production E2E 경로가 마땅하지 않은 점은 이번 계획에서 별도 harness를 추가하는 방식으로 해결하지 않는다. 대신 각 변경의 실제 책임 경계를 직접 검증하고, 가능한 외부 surface에서는 authoritative readback까지 수행한다.

## Definitions

**Backlog**

작업은 존재하지만 아직 실행 대상으로 승인되지 않은 대기 상태.

정상적인 workflow state이지만 active state도, terminal state도, Human Review state도 아니다. `Backlog` 상태의 task는 worker dispatch 대상이 아니다.

**Ready**

기존과 같이 dispatch eligibility를 갖는 상태.

**Delivery PR**

현재 작업 결과를 `main`으로 전달하기 위해 생성된 GitHub Pull Request. 기존 lifecycle에서 사용하는 `delivered_pr` 및 이후 승인·병합 대상 PR과 같은 identity를 의미한다.

**Plan fidelity**

publisher가 받은 Plan text의 내용이 Notion Plan body에서도 동일한 문자 정보로 보존되는 성질. 줄바꿈에 대해 이미 의도적으로 수행하는 정규화를 제외하고 HTML entity 변환이나 Unicode replacement를 허용하지 않는다.

**Responsibility boundary**

이번 변경에서 실제 동작을 결정하는 입력·출력 경계. Full E2E를 대신한다고 간주하지 않고, E2E가 없을 때 결함 가능성을 줄이기 위해 직접 검증할 최소 책임 단위다.

## Intent

현재 `Backlog`는 Notion state 선택지로 사용할 수 있지만 workflow가 정상 상태로 해석하지 못해 단순히 실행 전 작업을 보관하는 용도로 쓰기 어렵다. 실행시키고 싶지 않은 작업을 별도 우회 없이 `Backlog`에 둘 수 있어야 한다.

작업 결과로 PR이 생성된 뒤에는 Workpad를 보고 있는 사람이 별도 검색 없이 해당 PR을 바로 열 수 있어야 한다.

Plan은 실행 계약의 원문이므로 Notion에 publish되는 과정에서 문자가 다른 표현으로 저장되거나 손실되어서는 안 된다. 현재 관찰된 HTML numeric entity와 replacement character 문제를 증상별 임시 치환으로 처리하지 않고 실제 publish 경로에서 손실 지점을 확인해 원문 보존을 복구한다.

이 세 변경은 새로운 task surface나 lifecycle을 만드는 작업이 아니라 현재 surface를 실제 운영에 맞게 다듬는 작은 조정으로 취급한다.

## Decisions

### Backlog를 정상적인 비-dispatch state로 지원한다

`Backlog`를 repository workflow와 tracker/runtime state interpretation이 모두 인정하는 정식 비-dispatch state로 둔다.

`Backlog`는 active, terminal, Human Review 어느 범주에도 속하지 않으며 worker dispatch 대상이 아니다.

State parsing, reconciliation 또는 관찰 과정에서 unknown/invalid state 오류로 처리하지 않는다.

`Ready`의 기존 dispatch 의미는 유지한다.

현재 publisher의 `Backlog` state seed는 유지하고, workflow와 이를 해석하는 runtime/adapter 쪽 의미를 이 계약과 일치시킨다.

별도의 queue 기능이나 새로운 lifecycle mechanism은 만들지 않는다.

### Delivery PR은 기존 Workpad 안에서 바로 열 수 있게 남긴다

새로운 Notion property나 별도 PR tracking surface를 추가하지 않는다.

PR이 생성된 작업에서는 기존 Workpad의 delivery 기록이 해당 delivery PR을 직접 여는 GitHub URL을 보존하고, 실제 Notion surface에서 바로 열 수 있어야 한다.

기존 lifecycle에서 사용하는 `delivered_pr` identity를 계속 사용한다. PR identity를 나타내는 별도의 중복 필드를 만들지 않는다.

PR이 아직 존재하지 않는 단계에서는 placeholder 링크를 만들지 않는다.

Human Review, review, merging 등 이후 단계는 동일한 delivery PR identity를 계속 사용한다.

### Plan publication은 문자 정보를 보존한다

현재 증상만 보고 특정 escape/encoding 함수를 원인으로 가정하지 않는다.

실제 Plan 입력부터 Notion Plan body 작성까지의 publish 경로를 재현하여 HTML numeric entity 변환과 `�` 발생 지점을 확인하고, 해당 경계에서 원문 문자 보존을 복구한다.

수정 후에는 publisher가 받은 Plan text가 기존에 의도한 줄바꿈 정규화를 제외하고 동일한 Unicode text로 Notion에 저장되어야 한다.

다음을 허용하지 않는다.

* 실제 Unicode 문자가 `&#...;` 형태의 HTML numeric entity로 저장되는 것
* 유효한 Unicode 문자가 `�`로 대체되는 것
* 이미 정상적인 Unicode text를 다시 encode/decode하여 새로운 변형을 만드는 것

HTML entity를 사후 문자열 치환하는 방식처럼 관찰된 예시에만 맞춘 보정은 사용하지 않는다. 실제 손실이 발생하는 입력·변환 경계를 수정한다.

현재 정상 동작하는 Plan identifier, title, relation, publication retry/idempotency 및 canonical representation 계약은 유지한다.

### Full E2E 부재는 이번 변경에서 별도 인프라로 해소하지 않는다

현재 `main → Symphony → worker → GitHub PR → Workpad` 전체를 반복 가능하게 실행하는 대표 self-E2E 경로가 없다.

이번 계획에서는 이를 해결하기 위한 새로운 harness, disposable repository flow, 별도 orchestration tooling을 추가하지 않는다.

대신 각 변경마다 실제 책임 경계의 계약을 결정적으로 검증하고, 가능한 경우 실제 Notion/GitHub surface까지 live readback을 수행한다.

이 검증은 full E2E를 수행한 것으로 간주하지 않는다.

## Verification

### Backlog

`Backlog`에 대해 다음 두 계약을 함께 검증한다.

* workflow/tracker/runtime state interpretation에서 정상 state로 받아들여진다.
* dispatch 가능한 active state 집합에는 포함되지 않는다.

관련 state interpretation, reconciliation, dispatch selection 경로를 실제 구현으로 통과시키고 regression coverage를 추가한다.

가능하면 configured Notion task를 `Backlog`로 두고 실제 adapter/runtime read path에서 오류 없이 같은 state가 관찰되는지 확인한다.

Full Symphony polling 환경에서의 실제 non-dispatch 동작은 이번 계획에서 직접 E2E로 검증하지 않는다. 대신 dispatch 대상 결정 경계에서 `Backlog`가 제외되는 것을 결정적으로 검증한다.

### Workpad PR link

실제 Workpad write 경로에 delivery PR URL이 전달되었을 때 다음을 검증한다.

* 해당 delivery PR을 직접 여는 GitHub URL이 손실이나 변형 없이 Workpad content에 포함된다.
* 기존 `delivered_pr` identity와 같은 PR을 가리킨다.
* PR이 없는 단계에는 임의의 링크를 생성하지 않는다.

가능하면 실제 Notion Workpad에 대표 GitHub PR URL을 기록하고 readback하여 URL이 보존되는 것을 확인한다.

실제 worker가 새 PR을 생성한 직후 동일한 URL을 Workpad에 기록하는 full production E2E 연결은 이번 계획에서 직접 검증하지 않는다.

### Plan Unicode fidelity

실제 publisher entry point를 통해 문제를 재현 가능한 Unicode Plan을 publish한다.

가능하면 configured Notion database에서 authoritative readback까지 확인한다.

Live provider verification이 불가능하면 실제 provider payload와 publication read path를 검증하고, Notion-side serialization behavior가 남는 미검증 범위임을 명시한다.

검증에서는 다음을 확인한다.

* 입력 Unicode가 동일하게 보존된다.
* 원문에 없던 HTML numeric entity가 생성되지 않는다.
* 원문에 없던 replacement character `�`가 생성되지 않는다.
* chunk 경계를 지나도 동일한 결과가 유지된다.

관찰된 실제 실패 사례를 확보할 수 있으면 동일한 입력을 regression case로 포함하고, 수정 전 실패 조건이 수정 후 같은 publish 경로에서 재현되지 않는지 확인한다.

### Regression boundary

각 변경은 해당 책임 경계의 regression coverage를 가진다.

* state interpretation / dispatch eligibility
* Workpad delivery PR representation
* Plan text publication / round-trip fidelity

테스트가 기존 구현 세부에 맞춰 계약을 약화시키지 않도록 한다.

실제 외부 surface에서 확인 가능한 항목은 가능한 범위에서 mock이나 fixture보다 live readback을 우선한다.

이번 계획에서 남는 주요 미검증 범위는 세 변경을 하나의 실제 task lifecycle에서 함께 통과시키는 full production E2E 연결이다.

## Verification Tools

* **Leesh Loop workflow/runtime tests** — state interpretation, reconciliation, dispatch eligibility를 결정적으로 검증한다.
* **Notion task database와 task/Plan page** — `Backlog` state readback, Workpad PR URL 보존, published Plan content를 실제 provider surface에서 확인한다.
* **Notion publisher entry point** — 대표 Plan을 실제 publication 경로로 전달하고 Unicode fidelity를 검증한다.
* **Workpad writer/read path** — delivery PR URL이 실제 Workpad content로 전달되고 보존되는 책임 경계를 검증한다.
* **GitHub PR URL** — Workpad에 기록된 identity가 실제 delivery PR을 가리키는지 확인한다.
* **Repository regression tests** — 세 변경의 책임 경계를 반복 가능하게 검증한다.
* **직접 text comparison** — publisher 입력과 Notion readback을 비교해 entity 변환, replacement character, chunk boundary 손실 여부를 확인한다.

 별도 워크트리 브랜치에서 계획 복사해서 수행. 작업과 로컬 검증을 마친 뒤 `chatgpt-shot` 리뷰 루프를 수행하라.

## chatgpt-shot review log

- 리뷰한 HEAD: `7334143e4821d4933aa1e79362d1d45078dc1ad5` (Job `bb10d09a-93d8-45b5-8b0e-1ba18939c694`)
- verdict: `FINDINGS`
- `[medium]` Publish UI의 문서/폼 인코딩 미지정으로 브라우저 form 제출 전에 Unicode가 numeric entity로 변형될 수 있다는 finding을 수용했다. 현재 `page()`와 GET 응답 원문에 charset 선언이 없고, 서버 decode는 이미 변형된 ASCII entity를 복구할 수 없음을 확인했다.
- 적용한 커밋: `8eda79ba84e2e676bcb9c8d43a332b236ed5e502` — Publish UI에 `meta charset`, `accept-charset`, `Content-Type: text/html; charset=utf-8`를 추가했다.
- 검증 결과: 새 HEAD에서 Operator 14개, Publisher 25개, Symphony 330개 테스트 통과(6 skipped), `git diff --check` 통과. 새 HEAD를 대상으로 재리뷰한다.
- 리뷰한 HEAD: `0ac6f423163db78e00ae47900ecc55cb3cb91ede` (Job `50d47f80-3518-4dc2-8003-fc02b4a0fe69`)
- verdict: `PASS` (`None.`)
- finding 없음. 인코딩 선언 수정 후 Backlog, Workpad delivery URL, Plan Unicode fidelity 기준에서 추가 결함이 확정되지 않았다.
- 적용한 커밋: 없음
- 검증 결과: `None.` 결과를 확인했다. 이 review log 문서만 최종 커밋으로 추가한다.
