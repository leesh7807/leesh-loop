# Independent review Job 계약

## 제출과 조회

Worker는 준비된 `chatgpt-shot` Service client의 두 명령만 사용한다.

```sh
chatgpt-shot submit "<prompt>"
chatgpt-shot jobs <job-id>
```

`submit` 성공 시 stdout은 Review Result가 아니라 UUID Job ID다. 같은 ID로 `jobs`를 조회하면 JSON snapshot을 받으며, worker client는 `id`, `state`, `result`, `error`가 있는지 확인한다. `pending` 또는 `in_progress`이면 30초 후 같은 Job을 다시 조회한다. `completed`의 `result`가 리뷰 결과이고, `failed`의 `error`는 blocker 기록에 사용한다. 실행 중인 같은 review target을 중복 제출하지 않는다. Worker는 Service 시작·중지, 로그인, 복구를 하지 않는다. 이 경계는 [WORKFLOW.md](../WORKFLOW.md)와 [chatgpt-shot client](../operator/external/chatgpt-shot/chatgpt-shot)에 정의되어 있다.

## 보존되는 증거

Workpad에는 정확한 `review target`(PR URL)과 `review head`를 Job ID 앞에 기록한다. 완료 뒤에는 Job ID, completed Result, finding별 근거와 수용·기각 이유, 수정 및 재검증, 새 HEAD의 재리뷰 결과를 남긴다. 이 기록이 worker workflow의 리뷰 판단 근거다.

E2E evidence collector는 Workpad의 Job ID를 `chatgpt-shot jobs`로 다시 읽고, run record의 `evidence.snapshots[].chatgpt_shot`에 Job ID, 각 관측 시각과 상태, Result 또는 Error, 가용한 시작·완료 시각 및 소요 시간을 보존한다. `timing.chatgpt_shot`에는 마지막 Job의 terminal state와 Result/Error 관측, 관측된 소요 시간이 요약된다. 따라서 `completed`와 `failed` 양쪽의 terminal 증거를 구분할 수 있고, 이전 completed Job 결과를 현재 진행 중인 최신 Job에 재사용하지 않는다. 관련 구현은 [chatgpt-shot evidence client](../operator/e2e/systems/chatgpt-shot/chatgpt-shot-client.mjs), [evidence collector](../operator/e2e/run/evidence/run-evidence-collector.mjs), [timing recorder](../operator/e2e/run/run-timing.mjs)다.

## 확인

```sh
node --test operator/e2e/test/chatgpt-shot-client.test.mjs operator/e2e/test/run-evidence-collector.test.mjs
```

확인 결과: 4 tests passed, 0 failed. 이 focused check는 제어된 Job snapshot으로 ID 선택, terminal state/Result/소요 시간 보존을 확인한다. 실제 외부 Service에 review Job을 제출하거나 조회하지는 않았다.
