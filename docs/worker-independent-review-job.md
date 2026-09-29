# Worker independent review Job 경계

## 제출과 조회

Worker가 사용할 수 있는 명령은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. `submit` 성공 시 stdout은 Review Result가 아니라 Job ID(UUID)다. Result와 Error는 같은 ID를 `jobs`로 조회한 JSON snapshot에서 읽는다. Snapshot은 `id`, `state`, `result`, `error`를 제공한다. `pending`과 `in_progress`이면 30초 뒤 같은 Job을 다시 조회하고, `completed`이면 `result`를 review 결과로 사용하며, `failed`이면 `error`와 기존 blocker handoff를 기록한다. Job 제출, 조회 인터페이스는 Operator가 준비하며 Worker는 Service 수명주기나 인증을 관리하지 않는다.

## terminal 결과의 보존 증거

Workpad는 review target의 PR URL과 정확한 HEAD를 Job ID에 결합하고, terminal Result와 finding 처리 내역을 남긴다. E2E `ChatgptShotClient`는 Workpad의 Job ID를 `jobs`로 재조회해 각 관측의 시각, state, result/error와 가능한 시작·종료 시각 및 duration을 모은다. `RunEvidenceCollector`는 이 내용을 run snapshot의 `chatgpt_shot`에 보존한다. `RunTimingRecorder`는 `timing.chatgpt_shot`에도 Job ID, terminal state, duration 및 관측별 시각·state·result/error를 기록하며, 로컬 run record는 `operator/e2e/runs/<run-id>/run.json`이다. 따라서 완료 판정의 Result 근거는 `submit` 출력이 아니라 해당 Job의 terminal `completed` snapshot에 있는 `result`다.

## 집중 확인

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs operator/e2e/test/chatgpt-shot-client.test.mjs operator/e2e/test/run-evidence-collector.test.mjs
```

2026-09-29 실행 결과: **PASS — 6개 통과, 0개 실패.** Worker wrapper 테스트는 로컬 HTTP fixture를 사용하므로 실제 `chatgpt-shot` Service Job 실행 결과를 대신하지 않는다.
