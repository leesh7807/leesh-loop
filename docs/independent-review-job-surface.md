# Worker-facing independent review Job boundary

## 제출과 조회

Worker가 사용할 수 있는 명령은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. `submit`은 접수 후 Review Job UUID를 stdout으로 돌려주며, 리뷰 결과는 반환하지 않는다. Worker는 같은 ID를 30초 간격으로 조회한다. `pending`과 `in_progress`에서는 기다렸다가 같은 Job을 다시 조회하고, 실행 중인 같은 대상에 중복 제출하지 않는다. `completed`이면 `result`를 기존 리뷰 판정에 사용한다. `failed`이면 `error`와 진행 상황을 Workpad에 남기고 기존 `Human Review` blocker 절차를 따른다. Worker는 Service 시작·중지, 인증, 복구를 수행하지 않는다. 기준: [`WORKFLOW.md`](../WORKFLOW.md)의 Independent `chatgpt-shot` review gate.

## terminal 결과 evidence

[`chatgpt-shot-client.mjs`](../operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs)는 Workpad의 `Job ID`에서 UUID를 읽어 `jobs`로 조회한다. 조회 snapshot은 ID, 관측 시각, state, result, error와 시작·종료 시각 및 duration을 포함한다. 반환되는 terminal `result`는 `completed`에서만, terminal `error`는 `failed`에서만 채워진다. duration은 Job이 제공한 값을 우선 사용하고, 없으면 조회된 시작·종료 시각 차이로 계산한다.

E2E는 결과를 run record의 `timing.chatgpt_shot`에 보존한다. `terminal_state`와 `observed_duration_ms` 외에 `observations`에 관측 시각, Job ID, state, result, error를 기록한다. 원본 Job snapshot 전체를 복사하지는 않는다. 리뷰 요청의 PR URL, 정확한 HEAD, Job ID binding은 Notion Workpad에 기록한다. 기준: [`run-timing.mjs`](../operator/e2e/run/run-timing.mjs), [`run-record-store.mjs`](../operator/e2e/model/run-record-store.mjs), [`WORKFLOW.md`](../WORKFLOW.md).

## focused 확인

```sh
cd operator/e2e && node --test test/chatgpt-shot-client.test.mjs
```

2026-09-30 실행 결과: **PASS**, 3 tests passed, 0 failed. 테스트는 terminal state와 duration 보존, 최신 실행 중 Job의 상태 사용, 무관한 workspace UUID 제외를 확인했다. 실제 외부 Review Job은 제출하지 않았다.
