# Publisher 계획 발행과 Task handoff 조사

## 관찰한 진입점

워커에 노출된 `notion_task_publish_plan`은 `operator/symphony/lib/symphony_elixir/notion/agent_tool.ex`에서 현재 바인딩된 Task 범위를 확인한 뒤 `PlanPublication.publish/3`로 전달된다. `operator/symphony/lib/symphony_elixir/notion/plan_publication.ex`는 입력 Plan을 임시 파일로 저장하고 `operator/notion_publisher/dist/src/cli.js`를 실행해 canonical Publisher를 호출한다. 이 도구는 바인딩된 Task를 수정하지 않고 새 Task를 발행하며, worker 경로의 최종 State는 `Backlog`다.

## Canonical Plan과 Task 관계

`operator/notion_publisher/src/publisher.ts`는 Task를 임시 `Publisher Pending` 상태로 만들고 canonical representation을 확인한 뒤 최종 State를 설정한다. 전체 Plan 본문은 별도 Plan data source의 페이지에 저장된다. Publisher는 Plan 페이지의 `Identifier`와 제목, 전체 본문을 검증하고 페이지를 잠근 다음, Task의 `Plan` relation이 그 Plan 페이지 하나를 가리키는지 확인한다. `operator/notion_publisher/src/task-reader.ts`도 Task의 `Plan` relation을 따라 Plan 페이지 URL을 읽는다. 현재 바인딩된 Task의 읽기 결과에도 `Plan` relation이 연결되어 있음을 확인했다.

## 집중 검증

`operator/notion_publisher`에서 실행:

```sh
npm run build && node --test --test-name-pattern='finalization, relation wiring, and page locking' dist/test/notion.test.js
```

결과: `tsc` 빌드 성공, 선택된 검증 1개 통과(실패 0). 해당 테스트는 provider fake에 대해 Plan 페이지 잠금, Task의 `Plan` relation 연결, State 최종화를 확인한다. 실제 Notion 발행을 수행한 결과로 해석하지 않는다.
