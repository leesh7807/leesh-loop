# Worker-facing independent review Job 경계 조사

## Submit/readback 계약

`operator/external/chatgpt-shot/chatgpt-shot`은 worker에게 두 명령만 공개한다.

- `chatgpt-shot submit "<prompt>"`: Service의 `/jobs`에 `POST`하고 `{ prompt }`를 전송한다. 성공한 stdout은 review Result가 아니라 UUID 형식의 `Job ID`다.
- `chatgpt-shot jobs <job-id>`: 같은 Job을 `/jobs/<job-id>`에서 `GET`하고, `id`, `state`, `result`, `error`를 포함한 현재 snapshot을 JSON stdout으로 반환한다.

두 요청 모두 Operator가 준비한 discovery의 `127.0.0.1`/port와 credential을 사용한다. wrapper는 `doctor`, `start`, 인증·복구 같은 Service 관리 명령을 제공하지 않는다. 근거: `operator/external/chatgpt-shot/chatgpt-shot:5-25,54-70,72-81,105-118`.

## terminal 결과에 남는 증거

Independent review의 Workpad는 `review target`, `review head`, `Job ID`로 요청 identity를 고정한다. `operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs`는 Workpad에서 review Job ID만 추출해 `chatgpt-shot jobs <job-id>`를 조회하고, 각 조회에 대해 다음을 `observations`에 보존한다.

- Job `id`, 관찰 시각 `observed_at`, `state`, 원본 `result`/`error`
- `started_at`/`finished_at`와 제공된 `duration_ms`
- 조회 실패 시에도 `state: null`, 오류 문자열, 관찰 시각

마지막 snapshot이 `completed` 또는 `failed`일 때만 terminal로 간주한다. `completed`에서는 `result`, `failed`에서는 `error`를 각각 최종 값으로 노출하며, `duration_ms`가 없으면 시작·종료 시각의 차이를 `observed_duration_ms`로 계산한다. 실행 중인 마지막 Job이면 이전 completed Job의 Result를 재사용하지 않고 terminal Result를 `null`로 둔다. 근거: `operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs:9-26`.

## 집중 검증

명령:

```text
node --test operator/app/test/chatgpt_shot_worker.test.mjs operator/e2e/test/chatgpt-shot-client.test.mjs
```

실제 결과: 5개 테스트 통과, 0개 실패, 0개 취소·skip·todo, exit code `0` (Node test duration `371.17218ms`). 이 검증은 wrapper의 `POST /jobs` → UUID stdout → `GET /jobs/<job-id>` snapshot 흐름과, terminal evidence·실행 중인 최신 Job 우선 처리·무관한 UUID 무시를 확인했다.

이번 변경은 조사 문서와 Repository Plan만 추가하며 production behavior와 credential은 변경하지 않는다.
