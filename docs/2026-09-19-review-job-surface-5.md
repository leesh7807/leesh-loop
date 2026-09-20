# Worker-facing independent review 경계 조사

## 확인 범위

이 노트는 `operator/external/chatgpt-shot/chatgpt-shot`,
`operator/app/test/chatgpt_shot_worker.test.mjs`, `README.md`, `WORKFLOW.md`의
worker-facing independent review 계약을 요약한다. 이번 변경은 문서만 추가하며 production
behavior와 credentials는 변경하지 않는다.

## Submit/readback 계약

- Worker가 사용할 수 있는 명령은 `chatgpt-shot submit "<prompt>"`와
  `chatgpt-shot jobs <job-id>`뿐이다. Service lifecycle, authentication, browser recovery는
  worker 경계 밖이다.
- `submit`은 비어 있지 않은 prompt 하나를 받아 Service의 `POST /jobs`에
  `{"prompt":"<prompt>"}`를 보내고, stdout에 review Result가 아니라 UUID 형태의 Job ID를
  한 줄로 반환한다.
- `jobs`는 UUID 형태의 Job ID 하나를 받아 Service의 `GET /jobs/<job-id>`를 호출하고, Job
  snapshot JSON을 stdout으로 반환한다. 따라서 `submit` 직후 동일 Job ID를 조회해 상태를
  확인하는 비동기 계약이다.
- Job이 `pending` 또는 `in_progress`이면 같은 Job을 30초 후 재조회하며, 같은 review target에
  중복 submit하지 않는다. `completed`이면 snapshot의 `result`가 독립 리뷰 결과이고,
  `failed`이면 snapshot의 `error`가 blocker 근거다.

## Terminal 결과에 남는 증거

Terminal 결과를 artifact와 묶어 재현할 수 있도록 Workpad에 다음 binding을 Job ID 바로 앞에
기록한다.

```text
review target: <PR URL>
review head: <exact HEAD SHA>
Job ID: <UUID>
```

그 뒤 completed Job의 `result`와 finding별 검증/수용 또는 거부, 적용한 fix, post-fix verification,
re-review 결과를 기록한다. Job snapshot 자체는 `id`, terminal `state`, `result` 또는 `error`를
보존하며, PR URL과 exact HEAD는 어떤 review artifact가 판정되었는지 확정한다. `failed` 또는
Job ID를 받기 전 submit 실패는 결과로 간주하지 않고, 오류와 현재 검증 상태를 Workpad에 남긴
뒤 `Human Review` blocker로 인계한다.

## 직접 검증 명령 및 실제 결과

```text
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실행 결과: **PASS** — tests 2, pass 2, fail 0, cancelled 0, skipped 0, todo 0.

이 focused check는 실제 worker wrapper를 호출해 submit stdout이 Job ID인지, `jobs`가 terminal
snapshot을 반환하는지, 두 요청이 각각 올바른 HTTP method/path/body와 Bearer credential을
사용하는지, 지원하지 않는 명령과 잘못된 Job ID를 거부하는지를 확인한다.
