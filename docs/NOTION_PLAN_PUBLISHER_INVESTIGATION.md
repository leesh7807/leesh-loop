# Notion Plan Publisher 조사

## Publisher 진입점

핵심 API는 `operator/notion_publisher/src/publisher.ts`의 `publish()`다. CLI는 `operator/notion_publisher/src/cli.ts`에서 `--plan`, `--config`, `--database-url`을 읽어 이 API를 호출한다. Worker의 `notion_task_publish_plan`도 완전한 Plan을 같은 Publisher에 전달하며, 새 task의 최종 State를 `Backlog`로 지정한다. CLI 기본 State는 `Ready`다.

## Canonical Plan과 task

Publisher는 task data source와 별도의 Plan data source를 사용한다. task의 `Plan` relation은 정확히 하나의 Plan page를 가리키며, 두 page는 같은 publication `Identifier`를 가진다. 전체 Accepted Plan 본문은 Plan page에 저장되고 검증 후 잠긴다. task page 본문은 Workpad로 쓰이며 Plan 내용은 여기에 복사되지 않는다. Worker의 Publisher handoff 결과는 canonical `identifier`와 `page_id`다.

## 검증

실행 명령: `cd operator/notion_publisher && npm test`

실행 결과: PASS — TypeScript build 성공, 테스트 33개 통과, 실패 0개. Publisher의 canonical task/Plan 생성 검증을 포함한다. 이 검사는 테스트 Notion client를 사용했으며 실제 Notion page를 생성하지 않았다.
