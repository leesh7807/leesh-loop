# Worker-facing 독립 리뷰 Job 경계

조사 범위는 `operator/external/chatgpt-shot/chatgpt-shot` worker adapter와 이를 읽어
E2E evidence로 보존하는 `operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs`,
`operator/e2e/run/run-timing.mjs`이다. worker는 외부 Service의 수명주기나 인증을
관리하지 않고, 준비된 restricted interface만 사용한다.

## Submit/readback 계약

- 허용 명령은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. 그
  밖의 명령, 잘못된 인자 수, 빈 submit prompt는 usage 오류로 종료한다.
- `submit`은 Operator가 준비한 절대 경로의 `runtime.json`에서 `127.0.0.1`, port,
  credential을 읽고 `POST /jobs`를 호출한다. 요청 body는 `{ "prompt": "<prompt>" }`이고
  credential은 `Authorization: Bearer ...` 헤더로만 전달된다. HTTP 200 응답의 UUID Job
  ID만 stdout으로 반환한다.
- `jobs`는 UUID 형식의 Job ID만 받아 `GET /jobs/<id>`를 호출한다. HTTP 200 응답에
  `id`, `state`, `result`, `error`가 모두 있어야 하며, 검증된 JSON snapshot 전체를
  stdout으로 반환한다. 비-200 응답, 잘못된 JSON, 필드 누락은 오류이며 result로
  오인되지 않는다.
- Adapter에는 `doctor`, `start`, login, browser 복구 명령이 없고 raw `chatgpt-shot`
  Notion credential도 worker에 노출되지 않는다. Service 준비와 credential 보장은
  Operator의 책임이다.

## terminal 결과에 남는 evidence

`ChatgptShotClient`는 Workpad의 `Job ID: <UUID>` 항목을 provider 순서대로 읽고 각 ID에
`chatgpt-shot jobs <job-id>`를 호출한다. 매 snapshot마다 `observed_at`, `state`, `result`,
`error`를 `observations`에 남긴다. 마지막 Job만 terminal 판정 대상으로 삼으며,
`completed`일 때만 `result`를 independent review 결과로 채택하고 `failed`일 때만
`error`를 채택한다. 따라서 예전 Job이 `completed`여도 최신 Job이 실행 중이면 예전
result를 재사용하지 않는다.

E2E run record에는 위 `chatgpt_shot` snapshot과 함께 `job_id`, 첫/마지막 관찰 시각,
`terminal_state`, 관찰 duration, 관찰별 state/result/error가 `timing.chatgpt_shot`에
보존된다. Service가 제공한 `duration_ms` 또는 시작·완료 시각이 있으면 authoritative
duration으로 보존하고, 없으면 관찰 시각 차이를 사용한다. bearer credential과 HTTP
header는 record에 저장하지 않는다.

## 직접 검증

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실제 결과: exit code `0`, 2 tests passed, 0 failed, 0 skipped. 테스트는 fixture HTTP
Service를 통해 submit의 `POST /jobs`와 readback의 `GET /jobs/<id>` 요청·Bearer header·
응답 shape을 확인한다. 따라서 worker adapter 계약 검증이며, 실제 외부 Service의
가용성이나 review 내용 자체를 검증하는 실행은 아니다.
