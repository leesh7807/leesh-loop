# Worker-facing independent review Job

## 제출과 readback

Worker는 `chatgpt-shot submit "<prompt>"`으로 리뷰를 제출한다. 성공 시 stdout은 review Result가 아니라 Job UUID다. `chatgpt-shot jobs <job-id>`는 같은 Job의 현재 JSON snapshot(`id`, `state`, `result`, `error`)을 읽는다. Workflow에서 `pending`과 `in_progress`는 계속 조회하고, `completed`는 `result`를 사용하며, `failed`는 `error`를 기록한 뒤 기존 blocker 경로로 넘긴다. 같은 target의 실행 중 Job을 중복 제출하지 않는다.

이 interface는 준비된 Operator 소유 Service에 제출과 조회만 요청한다. Service 및 로그인/브라우저 lifecycle은 Operator 영역이며 worker 명령은 `submit`, `jobs`만 제공한다.

## Terminal 결과 근거

Workpad는 결과를 기록하기 직전에 `review target` (PR URL), `review head` (정확한 HEAD), `Job ID`를 연속해서 결박한다. 이후 completed Result 또는 failed Job Error, finding 판정과 후속 조치를 한국어로 보존한다. E2E evidence collector는 Workpad의 Job ID를 `jobs`로 다시 읽어 관측 시각, state, result/error와 제공된 시작·완료 시각/소요시간을 run record snapshot에 남긴다. timing 요약도 각 관측의 Job ID, State, Result/Error 및 관측 시각을 보존한다. run record는 `operator/e2e/runs/<run-id>/run.json`에 저장되어 nested workspace 정리와 분리해 유지된다.

## Focused check

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

이 테스트는 worker wrapper가 prompt를 `POST /jobs`로 보내고 Job ID를 stdout에 반환하며, `jobs` readback에서 terminal snapshot의 Result/Error를 돌려주는지 fixture Service로 확인한다. 실제 외부 Service 실행을 검증하는 명령은 아니다.

실행 결과 (2026-09-27): 통과 — 테스트 2개, 실패 0개.
