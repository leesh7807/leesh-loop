# Publisher의 Plan 발행과 작업 연결

## 진입점

작업자용 발행 기능 `notion_task_publish_plan`은 전체 Plan을 기존 Publisher 경로로 보내고, 최종 상태가 `Backlog`인 새 작업의 `identifier`와 `page_id`를 돌려준다. 저장소의 직접 호출 경로는 `operator/notion_publisher/src/cli.ts`다. CLI는 `--plan`, `--config`, `--database-url`을 받고, `publishPlanFile`이 Plan 파일을 UTF-8로 읽어 `publish()`에 전달한다. `publish()`는 데이터베이스와 Plan 내용에서 publication Identifier를 정하고, 중복 발행을 확인한 뒤 작업과 Plan의 정식 표현을 만든다. CLI 기본 상태는 `Ready`; 작업자 발행은 `Backlog`를 선택한다.

## 정식 Plan과 작업의 관계

작업과 Plan은 같은 Notion 데이터베이스 컨테이너 아래 별도 데이터 소스에 놓인다. 작업 데이터 소스의 `Plan` relation은 Plan 데이터 소스를 가리키며, 발행된 작업은 정확히 하나의 Plan 페이지에 연결된다. 양쪽 페이지의 `Identifier`가 같아 연결된 Plan의 발행 정체성을 확인한다. 작업 페이지 본문은 Workpad이고, 전체 Accepted Plan 본문은 별도 Plan 페이지에 저장된다. Publisher는 Plan 본문을 검증하고 페이지를 잠근 다음 relation을 연결하고 최종 상태로 전환한다.

현재 바인딩된 작업의 Notion readback에서도 `Plan` relation에 페이지 ID 하나가 반환됐다. 이 작업 표면은 연결된 Plan 페이지의 본문을 읽는 기능을 제공하지 않으므로, 이 실행에서 해당 본문 자체를 별도로 대조했다고 보지는 않는다.

## 검증

저장소 루트에서 실행할 focused check:

```sh
cd operator/notion_publisher && npm test
```

실행 결과: TypeScript 빌드 성공, 테스트 27개 통과, 실패 0개. Publisher의 두 데이터 소스 생성, 단일 Plan relation, 일치하는 Identifier, 잠금 및 Plan 본문 저장 검증을 포함한다. 이 테스트는 in-memory Notion 대역을 사용하므로 실제 Notion API 발행은 수행하지 않았다. 이번 변경은 조사 문서만 추가했다.
