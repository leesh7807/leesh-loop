# 2026-09-19-review-job-surface-16

## Objective

Worker-facing independent review 경계를 조사하고, `submit`/readback 계약과 terminal result에 남는 근거, 실제로 실행한 검증 명령을 설명하는 간결한 한국어 문서를 `docs/`에 추가한다.

## Intent

현재 운영 계약을 worker가 사용할 수 있는 명령과 결과 증거를 기준으로 설명한다. production 동작과 credentials는 변경하지 않는다.

## Verification Requirements

- 문서는 `chatgpt-shot submit "<prompt>"`의 Job ID 응답, `chatgpt-shot jobs <job-id>`의 snapshot, terminal State에 따른 Result/Error 사용을 정확히 설명한다.
- 문서는 exact PR/HEAD/Job ID의 Workpad 결박과 terminal 결과의 보존 경로를 설명하고, 구체적인 focused check 명령과 실제 결과를 기록한다.
- 변경은 조사 문서에 한정되며 production 동작과 credentials가 변경되지 않는다.

## Definitions

**Review Job**: 독립 리뷰 요청과 그 비동기 Job State/Result를 가리킨다.

**Terminal snapshot**: `completed` 또는 `failed` State와 해당 Result 또는 Error를 반환하는 `jobs` readback이다.

## Decisions

- 제출과 조회는 worker-facing interface의 public boundary로 설명하고, Operator가 소유하는 Service/configuration lifecycle과 구분한다.
- terminal evidence는 worker Workpad 결박과 E2E durable run record에서 확인되는 필드만 기술한다.
- production source, Service 상태, credential 값은 수정하거나 기록하지 않는다.

## Verification

- `operator/external/chatgpt-shot/chatgpt-shot`, `WORKFLOW.md`, `operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs`, E2E run evidence collection을 확인해 문서의 계약을 비교한다.
- worker command의 submit/readback focused test를 실행하고 실제 pass/fail 및 한계를 기록한다.
- 최종 diff와 `git diff --check`를 확인하고 Accepted Plan과 결과 문서를 비교한다.

## Verification Tools

- `node --test operator/app/test/chatgpt_shot_worker.test.mjs`: worker-facing wrapper의 제출 요청, Job ID stdout, Job snapshot readback을 fixture Service로 확인한다.
- `git diff --check`: 변경 문서의 whitespace 오류를 확인한다.
