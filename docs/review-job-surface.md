# Worker-facing independent review Job 경계 조사

## 조사 범위

현재 worker public surface는 `operator/external/chatgpt-shot/chatgpt-shot` wrapper와 `operator/app/test/chatgpt_shot_worker.test.mjs`에 있다. Worker는 Service를 관리하지 않고 다음 두 명령만 사용한다.

```text
chatgpt-shot submit "<prompt>"
chatgpt-shot jobs <job-id>
```

## Submit / readback 계약

1. `submit`은 prompt를 JSON `{ "prompt": "..." }`로 `POST /jobs`에 보내고, Service가 반환한 UUID를 stdout에 한 줄로 출력한다. 이 stdout은 review Result가 아니라 이후 조회에 사용할 Job ID다.
2. `jobs <job-id>`는 같은 Service에 `GET /jobs/<job-id>`를 보내고, `id`, `state`, `result`, `error` 필드가 모두 있는 JSON snapshot을 stdout으로 반환한다. 두 요청 모두 준비된 Service discovery의 Bearer credential을 사용하며, wrapper가 credential을 만들거나 저장하지는 않는다.
3. `pending`/`in_progress`에서는 같은 Job을 다시 조회하고, terminal State인 `completed`/`failed`가 되면 worker workflow가 snapshot을 판정한다. 별도의 worker-side Job store나 duplicate submit 경로는 없다.

근거: [`chatgpt-shot`](../operator/external/chatgpt-shot/chatgpt-shot) 72–81, 105–118행; async 계약은 [`2026-09-17-async-independent-review-job.md`](plans/completed/2026-09-17-async-independent-review-job.md)의 Job State/Review Result 정의와 polling 규칙에 기록되어 있다.

## terminal result에 남는 증거

Terminal 판단에 남는 최소 readback 증거는 다음 snapshot 필드의 조합이다.

| State | authoritative evidence | review gate에서의 의미 |
| --- | --- | --- |
| `completed` | `id`, `state: completed`, `result` | `result`가 independent review Result이며 PASS/finding 판정의 입력이다. |
| `failed` | `id`, `state: failed`, `error` | Job Error와 현재 검증 상태를 Workpad에 기록하고 `Human Review` blocker로 handoff한다. |

Wrapper는 `result`와 `error`를 값이 없어도 필드 자체가 존재하는지 검증해 보존한다. 따라서 terminal 증거의 권위는 submit stdout이 아니라 동일 Job의 readback snapshot이다. 현재 focused test는 제출된 prompt, `POST /jobs`, `GET /jobs/<id>`, Bearer header, UUID, `completed.result`, `error: null`을 한 흐름에서 확인한다.

## 직접 검증

검증 명령:

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실제 결과: **PASS** — 테스트 2개, 통과 2개, 실패 0개, 취소 0개, skip 0개 (`duration_ms 234.575968`).

이 검증은 임시 loopback fixture를 사용하므로 실제 외부 `chatgpt-shot` Service의 브라우저/Notion 실행까지 증명하지는 않는다. 대신 worker-facing wrapper의 제출·readback 계약과 terminal snapshot 전달을 직접 확인한다.

이 조사 변경에서는 production behavior, 외부 Service lifecycle, credentials를 변경하지 않았다.
