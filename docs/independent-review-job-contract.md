# Worker-facing independent review Job 계약

## 제출과 readback

Worker는 제한된 `chatgpt-shot` interface에서 다음 두 명령만 사용한다.

```text
chatgpt-shot submit "<prompt>"
chatgpt-shot jobs <job-id>
```

성공한 `submit`의 stdout은 review 결과가 아니라 Job UUID다. Worker는 이 ID로 `jobs`를 호출해 Job snapshot을 읽는다. Snapshot은 `id`, `state`, `result`, `error`를 제공한다. `pending`과 `in_progress`는 비종료 상태이므로 같은 ID를 30초 간격으로 다시 조회한다. `completed`와 `failed`는 종료 상태다. `completed.result`는 기존 finding 검증과 disposition 흐름에 입력하고, `failed.error`는 Korean Workpad에 남긴 뒤 기존 `Human Review` blocker 경로를 따른다. Job ID를 받기 전 `submit`이 실패해도 기존 blocker handoff를 사용한다.

Worker는 `chatgpt-shot` Service를 시작하거나 중지하거나 인증·복구하지 않는다. 이 경계의 공개 명령은 제출과 Job readback이다.

## 종료 결과와 보존 증거

Job readback의 `id`와 terminal `state`는 어떤 Job을 확인했는지와 종료 여부를 식별한다. `completed`에서는 `result`, `failed`에서는 `error`가 해당 종료 결과의 내용이다. Job snapshot 자체에는 요청 대상 PR과 HEAD를 연결하는 근거가 이 interface에서 보장되지 않으므로, Workpad가 그 연결을 보존한다. 결과 기록 전에 다음 target binding을 Job ID 바로 앞에 둔다.

```text
review target: <PR URL>
review head: <exact HEAD SHA>
Job ID: <UUID>
```

Workpad에는 이어서 terminal Result 또는 Job Error, 각 finding의 근거 기반 수용·기각 사유, 적용한 수정, 수정 후 검증, 새 HEAD의 재검토 결과를 기록한다. 따라서 확인 가능한 review evidence는 PR/HEAD와 Job ID의 결합, terminal snapshot의 `state` 및 `result`/`error`, 그리고 Result의 finding disposition이다. transcript 전체를 Repository Plan에 복사하지 않는다.

## 집중 확인

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

이번 확인 결과: 2개 테스트 통과, 0개 실패. 테스트는 local HTTP fixture를 통해 wrapper가 `submit`에서 UUID를 출력하고 `jobs`에서 completed snapshot의 `id`, `state`, `result`, `error`를 읽는지, 지원하지 않는 명령과 잘못된 Job ID를 거부하는지 확인했다. 이 focused check는 worker wrapper 계약을 검증하며 실제 외부 Service 실행을 증명하지는 않는다.
