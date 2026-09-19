# 2026-09-19-review-job-surface

## Objective

저장소의 worker-facing independent review 경계를 조사하고, `submit`/readback 계약, terminal result에 남는 증거, 구체적인 검증 명령을 설명하는 간결한 한국어 조사 문서를 `docs/` 아래 추가한다.

Production behavior와 credentials는 변경하지 않는다.

## Intent

현재 구현과 테스트를 기준으로 worker가 독립 리뷰를 제출하고 durable Job을 조회하는 경계를 명확히 기록한다.

## Verification Requirements

- 조사 문서는 실제 worker-facing wrapper와 focused test에 근거해야 한다.
- `submit`의 Job ID 반환, `jobs <job-id>`의 snapshot readback, terminal State의 `result`/`error` 증거를 구분해 설명해야 한다.
- 저장소가 제공하는 가장 직접적인 focused check를 실행하고 실제 결과를 문서에 기록해야 한다.
- Production 코드, 외부 Service lifecycle, credentials는 변경하지 않아야 한다.

## Definitions

**Review Job**은 independent review 요청과 durable lifecycle을 묶은 단위다.

**Terminal result**는 `completed` 또는 `failed` State에서 readback되는 최종 증거다. `completed`는 `result`, `failed`는 `error`를 사용한다.

## Decisions

- 조사 범위는 `operator/external/chatgpt-shot/chatgpt-shot`, 그 focused test, 그리고 현재 async review 계약 문서로 한정한다.
- 변경은 조사 문서와 이 Repository Plan의 durable 기록으로만 제한한다.
- `submit` stdout은 Result가 아닌 Job ID로 기록하고, Result/Error는 동일 Job의 `jobs` snapshot에서 읽는 계약으로 기록한다.

## Verification

`node --test operator/app/test/chatgpt_shot_worker.test.mjs`를 실행해 실제 worker-facing wrapper의 submit/readback 요청과 unsupported command/invalid Job ID 경계를 확인한다. 테스트의 실제 통과 결과를 조사 문서에 기록한다.

## Verification Tools

- `operator/external/chatgpt-shot/chatgpt-shot`: worker-facing public command와 snapshot schema 확인.
- `operator/app/test/chatgpt_shot_worker.test.mjs`: POST submit, GET readback, 인증 헤더와 반환값 확인.
- `node --test operator/app/test/chatgpt_shot_worker.test.mjs`: 대표 focused check 실행.
