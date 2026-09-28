# Publisher의 Plan 공개와 task handoff

## 관찰한 진입점

일반 제출 진입점은 Operator의 **Publish a Plan** 화면이다. 폼은 `POST /api/v1/publish`를 호출하고, Operator는 Plan을 임시 파일에 기록해 `operator/notion_publisher/dist/src/cli.js`를 실행한다. CLI는 `publish()`를 호출한다. canonical task와 Plan 표현 검증이 끝나면 일반 발행의 기본 `State`인 `Ready`로 넘긴다.

Worker의 `notion_task_publish_plan`도 Symphony의 `PlanPublication`을 거쳐 같은 Publisher CLI를 호출한다. 이 경로는 새 task를 `Backlog`로 발행하고 canonical `identifier`와 `page_id`를 반환한다. 현재 task의 relation은 수정하지 않는다.

## Canonical Plan/task 관계

Task와 Plan은 같은 Notion database container 아래의 별도 data source에 놓인다. Task의 `Plan` 속성은 정확히 한 Plan page를 가리키며, 양쪽 `Identifier`가 같아야 한다. 전체 Accepted Plan은 Plan page 본문에 저장되고 그 page는 검증 후 잠긴다. Task page 본문은 Workpad다. Tracker adapter는 task 본문을 Plan 대용으로 읽지 않고, 명시된 `Plan` relation을 따라 description을 구성한다.

## 집중 확인

다음 명령은 Publisher TypeScript 빌드와 관련 테스트를 실행한다.

```sh
cd operator/notion_publisher && npm test
```

실행 결과: **통과** — 테스트 29개, 실패 0개. `normal publisher entry point creates the two-source canonical representation`도 통과했다. 이 검사는 자동화된 Publisher 테스트 결과이며, 실제 Notion 발행을 수행한 것은 아니다.

근거: `operator/app/operator-ui-server.mjs`, `operator/notion_publisher/src/cli.ts`, `operator/notion_publisher/src/publisher.ts`, `operator/symphony/lib/symphony_elixir/notion/plan_publication.ex`, `operator/symphony/docs/notion_adapter.md`, `docs/NOTION_PLAN_PUBLISHER.md`.
