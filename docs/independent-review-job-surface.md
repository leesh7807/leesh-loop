# Worker-facing independent review Job surface

## 조사 범위

대상은 worker가 호출하는 `operator/external/chatgpt-shot/chatgpt-shot`와 그 경계를 검증하는 `operator/app/test/chatgpt_shot_worker.test.mjs`다. Worker는 Service를 시작·중지·인증·복구하지 않고, 준비된 discovery record를 통해 아래 두 명령만 사용한다.

## Submit contract

`chatgpt-shot submit "<prompt>"`는 인자가 정확히 두 개이고 prompt가 공백만으로 이루어지지 않아야 한다. 준비된 discovery record에서 `host=127.0.0.1`, 유효한 port, non-empty credential을 확인한 뒤 `POST /jobs`로 `{"prompt":"<prompt>"}`를 보내고 Bearer credential을 전달한다 (`operator/external/chatgpt-shot/chatgpt-shot:45-82`).

Service가 HTTP 200과 UUID v4 형식의 `id`를 반환하면 stdout에는 JSON 결과가 아니라 그 Job ID 한 줄만 출력된다 (`105-112`). 따라서 submit의 stdout은 review Result가 아니라 이후 `jobs <job-id>` readback을 위한 binding이다.

## Readback contract

`chatgpt-shot jobs <job-id>`는 UUID v4 Job ID만 허용하고, `GET /jobs/<job-id>`로 snapshot을 읽는다 (`19-23`, `52-57`, `72-82`). HTTP 200 응답은 문자열 `id`와 `state`를 가지며 `result`와 `error` 필드도 반드시 포함해야 한다. 검증을 통과한 snapshot 전체가 stdout에 JSON 한 줄로 출력된다 (`113-119`).

Workflow는 같은 Job을 `pending` 또는 `in_progress` 동안 반복 poll하고, `completed`이면 snapshot의 `result`를 independent review Result로 사용하며, `failed`이면 `error`를 blocker evidence로 사용한다. `submit` 자체가 terminal result를 보장하거나 보관하지는 않는다.

## Terminal result에 남는 evidence

Worker-facing shell은 terminal 상태를 local state로 저장하지 않는다. 따라서 결과를 식별하고 재현할 수 있는 evidence는 다음 두 층으로 구분된다.

1. Workpad의 바로 앞 binding: `review target`, 정확한 `review head`, `Job ID`. 이 조합은 어떤 PR/HEAD에 대한 Job인지 고정한다.
2. 같은 Job의 terminal snapshot: `id`, `state`, 그리고 `completed`일 때 `result` 또는 `failed`일 때 `error`. 이 snapshot은 Job ID와 terminal outcome을 함께 보존한다.

경계 test는 `submit`의 stdout이 고정된 Job ID인지, readback이 `state: completed`, `result`, `error: null`을 모두 보존하는지, 그리고 POST/GET 경로와 prompt 전달이 맞는지를 확인한다 (`operator/app/test/chatgpt_shot_worker.test.mjs:15-57`). Unsupported command와 잘못된 Job ID도 거부된다 (`59-62`).

## Concrete verification

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실행 결과: PASS — 2 tests passed, 0 failed (`worker-facing chatgpt-shot exposes async submission and Job snapshots`; `worker-facing chatgpt-shot rejects unsupported commands and invalid Job IDs`). 추가로 `git diff --check`도 exit code 0으로 통과했다.
