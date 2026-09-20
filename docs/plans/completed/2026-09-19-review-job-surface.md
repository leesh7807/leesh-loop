# 2026-09-19-review-job-surface

## Objective

worker-facing independent review boundary를 조사하고, `docs/` 아래 한국어 investigation note에 submit/readback contract, terminal result에 남는 evidence, concrete verification command를 기록한다. Production behavior와 credentials는 변경하지 않는다.

## Intent

독립 리뷰는 비동기 Job으로 제출되고 별도 readback으로 terminal result를 확인한다. Worker가 실제로 호출할 수 있는 표면과 결과의 authoritative evidence를 짧고 정확하게 설명할 수 있어야 한다.

## Verification Requirements

* note가 `submit`과 `jobs <job-id>`의 실제 worker-facing contract를 정확히 구분한다.
* terminal result에 대해 Job identity, terminal state, `result` 또는 `error`와 Workpad binding이 어떤 evidence인지 설명한다.
* 최소 하나의 직접적인 focused check를 실행하고 실제 결과를 note에 기록한다.
* production behavior와 credentials를 변경하지 않는다.

## Definitions

**Review Job**

worker가 review prompt를 전달한 뒤 Service가 비동기로 처리하는 작업이다. `submit`은 결과 본문이 아니라 Job ID를 반환한다.

**Job snapshot**

`jobs <job-id>`가 반환하는 `id`, `state`, `result`, `error`를 포함한 JSON readback이다.

## Decisions

### 기존 worker-facing 표면만 기록한다

조사 note는 `operator/external/chatgpt-shot/chatgpt-shot`의 `submit`과 `jobs` 경계 및 해당 focused test를 근거로 작성한다. Service lifecycle, authentication, browser recovery 또는 새로운 persistence는 이번 작업의 범위가 아니다.

### Repository Plan은 실행 계약만 보존한다

실행 이력과 review transcript는 Workpad에 남기고 이 Plan에는 복사하지 않는다. 최종 note의 파일명과 책임이 현재 역할을 드러내도록 `docs/independent-review-job-surface.md`를 사용한다.

## Verification

worker-facing adapter test를 직접 실행해 prompt가 `POST /jobs`로 전달되고, stdout이 Job ID를 반환하며, `GET /jobs/<job-id>`의 completed snapshot이 `result`와 `error`를 보존하는지 확인한다. 명령과 실제 결과는 investigation note에 기록한다.

## Verification Tools

* `node --test operator/app/test/chatgpt_shot_worker.test.mjs` — worker-facing submit/readback contract와 command restriction을 focused boundary에서 검증한다.
* `git diff --check` — 추가 문서의 whitespace 오류를 확인한다.
