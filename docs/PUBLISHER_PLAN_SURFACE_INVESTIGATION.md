# Publisher Plan surface 조사

## 관찰된 Publisher 진입점

실행 진입점은 `operator/notion_publisher/src/cli.ts`의 `main()`이다. CLI는 `--plan`, `--config`, `--database-url`을 읽고 `publishPlanFile()`을 호출한다. 이 함수가 Plan 파일과 policy를 읽은 뒤 `publish({ plan, databaseUrl, fallbackTitle, client, config })`로 handoff한다. 핵심 publication 흐름은 `operator/notion_publisher/src/publisher.ts`의 `publish()`에 있다.

## Canonical Plan/task 관계

Publisher는 database 아래의 data source schema를 구조적으로 찾아 task data source와 sibling Plan data source를 결정한다. task에는 `Identifier`, `Title`, `State`, `Priority`, `Labels`, `Blocked By`, `Plan`이 있고, `Plan` relation은 Plan data source를 단일 대상으로 삼는다(`docs/NOTION_PLAN_PUBLISHER.md`, `operator/notion_publisher/src/notion.ts`).

publication identifier로 task를 찾은 뒤, task의 `Plan` relation이 가리키는 Plan page가 같은 `Identifier`와 `Title`을 갖는지 확인한다. Plan 본문은 별도 Plan page에 기록·검증하고 page를 lock한 다음, task relation을 연결하고 task State를 `Ready`로 finalize한다. task page body는 Workpad이며 accepted Plan 본문과 분리된다. 따라서 task는 실행 lifecycle과 handoff의 record이고, Plan page는 immutable accepted snapshot의 canonical record다.

## 구체적인 검증 명령 및 실제 결과

```sh
cd operator/notion_publisher && npm test
```

2026-09-20 실행 결과: `tsc` build 성공, Node test **25 passed / 0 failed / 0 skipped**.

이번 변경은 이 조사 노트와 Repository Plan 문서만 추가하며 production behavior와 credentials는 변경하지 않는다.
