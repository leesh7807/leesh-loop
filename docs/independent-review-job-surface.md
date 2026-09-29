# 독립 리뷰 Job 제출과 결과 조회

Worker-facing independent review는 `chatgpt-shot`의 비동기 Job 경계를 사용한다. `submit` 성공은 리뷰 완료를 뜻하지 않는다. 반환된 Job ID를 `jobs`로 조회해 terminal 상태와 결과를 읽는다.

## 제출과 readback

- `chatgpt-shot submit "<prompt>"`는 prompt를 제출하고 성공 시 UUID 형식의 Job ID 한 줄을 stdout에 반환한다. 이 ID는 Review Result가 아니다.
- `chatgpt-shot jobs <job-id>`는 동일 Job의 snapshot을 JSON 한 줄로 반환한다. Worker wrapper는 `id`, `state`, `result`, `error` 필드를 확인하고 snapshot 전체를 전달한다. 추가 필드가 있으면 함께 보존된다.
- `pending`과 `in_progress`에서는 같은 Job을 계속 조회한다. `completed`의 `result`가 review 내용이며, `failed`의 `error`는 blocker 처리에 쓰인다.
- 실제 terminal 결과의 권위 있는 readback은 Service가 돌려준 `jobs` snapshot이다. Worker wrapper 자체에는 별도 Job 저장소가 없다.

## 남는 증거

E2E `ChatgptShotClient`는 Workpad의 Job ID를 읽어 각 Job을 조회하고, 관측 시각·상태·result·error와 제공된 시작/완료 시각 및 duration을 observation으로 정리한다. 최신 Job의 terminal 상태가 `completed`이면 해당 `result`, `failed`이면 해당 `error`를 요약값에 담는다. `RunEvidenceCollector` snapshot은 run record의 `evidence.snapshots`에 보존되고, timing 요약에는 Job ID, 첫/마지막 관측 시각, terminal 상태, 관측별 result/error와 관측 가능한 duration이 남는다.

Independent review Workpad 기록에는 review target(PR URL과 exact HEAD), Job ID, 완료된 Result, finding의 근거 기반 disposition, 수정 및 재검증 결과가 남는다. 따라서 run record는 readback 관측 증거를, Workpad는 리뷰 대상과 작업자의 판단·조치 기록을 보존한다.

## 집중 확인

```sh
node --test operator/app/test/chatgpt_shot_worker.test.mjs operator/e2e/test/chatgpt-shot-client.test.mjs operator/e2e/test/run-evidence-collector.test.mjs
```

이 명령은 worker wrapper의 Job ID/snapshot 표면, E2E terminal readback 해석, run evidence의 Job 관측 보존을 확인한다. Live Service의 별도 제출은 수행하지 않는다.
