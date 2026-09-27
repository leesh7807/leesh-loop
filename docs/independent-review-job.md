# Independent `chatgpt-shot` 리뷰 Job 계약

## 제출과 readback

Worker가 사용할 수 있는 명령은 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`뿐이다. 성공한 `submit`의 stdout은 리뷰 결과가 아니라 Review Job ID다. Workpad에 `review target`(PR URL), `review head`(정확한 HEAD SHA), `Job ID`를 연결해 기록한 뒤, 같은 Job을 30초 간격으로 조회한다. `pending`과 `in_progress`에서는 기다리며, 같은 대상에 중복 제출하지 않는다. `completed`의 `result`만 리뷰 결과로 사용하고, `failed`는 Job `error`를 기록해 기존 `Human Review` blocker 경로로 넘긴다.

## terminal 결과의 보존 증거

Workpad에는 PR/HEAD와 Job ID의 결합, 완료 결과, finding별 근거와 수용·기각 사유, 수정 및 재검증, 재리뷰 결과를 남긴다. 전체 transcript는 Repository Plan에 복사하지 않는다.

`ChatgptShotClient.inspectReviewJobs`는 조회마다 시각, Job ID, state, result/error, 시작·완료 시각과 duration을 observation으로 만든다. 결과 요약에는 마지막 Job의 상태(`terminal_state` 필드)와 terminal duration을 보존하고, `completed`일 때만 `result`, `failed`일 때만 `error`를 채운다. duration은 Job이 제공한 `duration_ms`를 우선 사용하고 없으면 시작·완료 시각 차이로 계산한다. E2E run snapshot은 이 요약과 observations를 `chatgpt_shot`에 보존하며, run timing에도 Job ID, 첫·마지막 관측 시각, 최근 상태, result/error, 관측 duration을 기록한다. 따라서 비terminal 관측은 완료 결과로 오인되지 않고, 실패는 결과 대신 오류로 남는다.

## 집중 확인 명령

```sh
node --test operator/e2e/test/chatgpt-shot-client.test.mjs
```

이 테스트는 완료 Result와 duration 보존, 최신 Job이 실행 중일 때 이전 완료 Job을 재사용하지 않는 동작, 무관한 UUID 제외를 확인한다.
