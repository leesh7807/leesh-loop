# Worker-facing independent review 경계

## Submit 계약

Worker는 `chatgpt-shot submit "<prompt>"`만 사용해 리뷰를 제출한다. 명령은 prompt가 비어 있지 않은지 확인하고 준비된 local Service의 `/jobs`에 `{"prompt":"<prompt>"}`를 POST한다. Service가 성공적으로 반환한 UUID가 stdout의 유일한 Job ID이며, 이 stdout은 리뷰 결과가 아니다. 인자 오류, discovery 오류, 비정상 응답, 잘못된 Job ID가 반환되면 명령은 stderr 오류와 실패 상태로 끝난다.

## Readback 계약

Worker는 `chatgpt-shot jobs <job-id>`로 같은 Job을 조회한다. 명령은 UUID v4 형식을 먼저 확인하고 `/jobs/<job-id>`를 GET한다. 성공한 readback은 `id`, `state`, `result`, `error`를 모두 포함한 JSON snapshot 한 줄이다. `pending` 또는 `in_progress`이면 같은 Job을 다시 조회하고, `completed`이면 `result`를 독립 리뷰 결과로 사용한다. `failed`이면 `error`와 당시 구현·검증 상태를 blocker evidence로 남긴다. 잘못된 JSON, HTTP 오류, 필수 필드가 빠진 snapshot은 정상 결과로 취급하지 않는다.

## Terminal result에 남는 evidence

CLI는 Job 결과를 별도 파일에 저장하지 않는다. Service의 Job snapshot이 실행 중인 원본 readback이고, Workpad가 리뷰 artifact와 terminal 결과를 묶는 durable evidence surface다. Workpad에는 결과를 기록하기 직전에 다음 binding을 Job ID 바로 앞에 남긴다.

```text
review target: <PR URL>
review head: <exact HEAD SHA>
Job ID: <UUID>
```

따라서 terminal evidence는 최소한 정확한 PR URL, 그 시점의 exact HEAD, Job ID, terminal `state`, 그리고 `completed`의 `result` 또는 `failed`의 `error`와 구현·검증 상태다. `result` 문서의 `# Verdict`와 `# Findings`는 독립 리뷰 판단을 보존하는 내용이며, 다른 PR/HEAD의 Job과 섞어 쓰지 않는다. Repository Plan에는 전체 transcript를 복사하지 않고 reviewed identity, verdict, finding disposition, 적용 commit, verification summary만 간결하게 남긴다.

## Focused check

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs
```

실행 결과: `2 tests`, `2 pass`, `0 fail` (`duration_ms 235.321114`). 이 검사는 worker-facing CLI를 실제로 실행해 submit POST, prompt body, bearer authorization, Job ID stdout, completed readback JSON, unsupported command와 invalid Job ID를 확인한다. 로컬 HTTP fixture를 사용하므로 실제 browser/Service 인증이나 외부 리뷰 품질까지 증명하지는 않는다.
