# Worker 독립 리뷰 Job 경계

## Submit 및 readback 계약

Worker가 사용할 수 있는 명령은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. `submit` 성공 시 stdout은 review 결과가 아니라 Job UUID다. 결과를 확인하려면 같은 ID로 `jobs`를 조회한다. 응답은 `id`, `state`, `result`, `error`를 포함한 Job snapshot이며, Worker wrapper는 snapshot JSON을 그대로 출력한다. `pending`과 `in_progress`에서는 같은 Job을 30초 뒤 다시 조회하고, `completed`의 `result`를 리뷰 결과로 사용한다. `failed`에서는 `error`를 기록하고 기존 blocker handoff를 따른다.

리뷰 요청의 선언된 대상을 보존할 때는 Workpad에 `review target`의 PR URL, `review head`의 정확한 HEAD SHA를 기록한 뒤 `Job ID`를 기록한다. E2E 수집기는 Workpad의 이 맥락과 Job snapshot을 함께 보존하지만, Job ID로 조회할 뿐 해당 Job이 기록된 PR/HEAD를 실제로 리뷰했는지는 검증하지 않는다.

## Terminal 결과 증거

E2E `RunEvidenceCollector`는 canonical Workpad에서 Review Job ID를 읽고 `jobs` snapshot을 수집한다. 각 Job 관측에는 Job ID, 관측 시각, state, result/error, 시작·종료 시각과 duration이 포함된다. `completed`이면 terminal `result`, `failed`이면 terminal `error`를 유지한다. `RunTimingRecorder`는 `timing.chatgpt_shot`에 Job ID, 첫·마지막 관측 시각, 관측별 state/result/error, terminal state와 관측 duration을 기록한다. 원본 증거 snapshot(Workpad 맥락 포함)과 timing은 `operator/e2e/runs/<run-id>/run.json`에 보존된다. 이 run record는 Service가 보유한 durable Job을 대체하지 않고 수집 시점의 증거를 남긴다. 따라서 저장된 PR/HEAD과 Job ID 사이의 provenance는 보존된 요청 맥락일 뿐, E2E 수집기가 검증한 연결은 아니다.

## 확인

Worker wrapper와 E2E Job 증거 경로의 focused check:

```bash
node --test operator/app/test/chatgpt_shot_worker.test.mjs operator/e2e/test/chatgpt-shot-client.test.mjs operator/e2e/test/run-evidence-collector.test.mjs
```

실행 결과: **PASS**, 6개 테스트 통과, 0개 실패. 이 확인은 worker wrapper의 submit/readback round trip, Job ID 해석, terminal evidence와 duration 기록을 검증했다.
