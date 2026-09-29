# Worker-facing independent review Job 계약

Worker는 review 요청을 `chatgpt-shot submit "<prompt>"`로 제출한다. 성공 시 stdout은 review 결과가 아니라 후속 조회에 쓰는 Job ID(UUID)다. `chatgpt-shot jobs <job-id>`는 durable Job snapshot을 JSON으로 반환하며, worker는 `id`, `state`, `result`, `error`를 확인한다. Operator가 Service와 인증을 소유하고, worker 표면은 `submit`과 `jobs`만 지원한다.

`pending`과 `in_progress`에서는 같은 Job을 30초 간격으로 다시 조회한다. `completed`와 `failed`는 terminal 상태다. 완료 시 `result`를 기존 finding 검증에 사용한다. 실패 시 `error`와 현재 구현·검증 상태를 Workpad에 남기고 `Human Review`의 blocker handoff를 한다. 미완료 Job에 같은 review target을 중복 제출하지 않는다.

Workpad에는 각 review target의 PR URL과 정확한 HEAD를 Job ID 바로 앞에 기록해 Job과 산출물의 결속을 보인다. Terminal 결과에는 Job ID와 완료 `result` 또는 실패 `error`를 기록하고, 각 finding의 근거 기반 수용·기각, 수정, 수정 후 검증, 재검토 결과를 보존한다. `result` 전문을 Repository Plan에 복사하지 않는다.

## 확인 명령

제출 stdout에서 받은 ID를 사용해 동일 Job을 읽는다.

```sh
chatgpt-shot jobs "$JOB_ID"
```
