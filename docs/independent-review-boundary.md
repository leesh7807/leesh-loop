# Worker-facing independent review 경계

## Submit/readback 계약

Worker가 사용할 수 있는 표면은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. Worker wrapper는 Operator가 준비한 absolute discovery 경로에서 `127.0.0.1` Service의 `port`와 non-empty `credential`을 읽고 Bearer 인증을 붙인다. `submit`은 `/jobs`에 `{ "prompt": "..." }`를 POST하고 성공 시 review 결과가 아닌 UUID Job ID만 stdout으로 반환한다. `jobs`는 같은 Job ID의 `/jobs/<job-id>`를 GET하고 `id`, `state`, `result`, `error`가 있는 현재 snapshot을 JSON으로 반환한다. 오류는 stderr와 non-zero exit로 보고한다. Service 시작·중지·인증·복구, 별도 Job store, retry 정책은 Worker 경계 밖이다.

Workflow는 `pending`/`in_progress`이면 같은 Job을 30초 후 다시 읽고, `completed`이면 snapshot의 `result`를 독립 리뷰 Result로 사용하며, `failed`이면 `error`와 현재 검증 상태를 blocker로 기록하도록 정의한다.

## terminal result에 남기는 증거

Job ID를 Workpad에 기록하기 직전에 다음 binding을 보존한다.

```text
review target: <PR URL>
review head: <exact HEAD SHA>
Job ID: <UUID>
```

이 binding 뒤에 terminal snapshot의 `result` 또는 `error`를 기록하고, completed 결과라면 finding별 evidence-based 수용/기각, 적용한 fix, post-fix verification, re-review 결과까지 남긴다. `failed` 또는 Job ID 이전 submit 실패라면 오류와 현재 implementation/verification 상태를 기록하고 `Human Review`의 `reason: blocker`로 authoritative State readback을 수행한다. 따라서 terminal 결과의 판정 근거는 단순 Job ID가 아니라 `PR URL + exact HEAD + Job ID + terminal result/error + 후속 처리 증거`의 묶음이다.

## 직접 검증 명령과 실제 결과

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실제 결과: `tests 2`, `pass 2`, `fail 0`, `cancelled 0`, `skipped 0` (exit 0, duration 338.179055ms).

이 focused test는 로컬 HTTP fixture를 통해 submit의 UUID 반환, jobs의 `completed` snapshot(`result` 포함), Bearer 전달, 지원하지 않는 명령과 잘못된 Job ID 거부를 확인한다. 실제 외부 Service/ChatGPT 실행 자체가 아니라 Worker wrapper 계약을 검증하는 범위다.

근거: `operator/external/chatgpt-shot/chatgpt-shot`, `operator/app/test/chatgpt_shot_worker.test.mjs`, `WORKFLOW.md`의 independent `chatgpt-shot` review gate.
