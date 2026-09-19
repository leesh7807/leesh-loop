# Canonical Plan/task publication 조사

## 확인된 Publisher entry point

Publisher의 실행 진입점은 `operator/notion_publisher/src/cli.ts`의
`publishPlanFile()`이다. 이 함수는 `--plan` 파일을 UTF-8로 읽고 설정을
불러온 뒤 `publish({ plan, databaseUrl, fallbackTitle, client, config })`를
호출한다(`cli.ts:9-12`). CLI의 `main()`은 `--plan`, `--config`,
`--database-url`을 받고 `NOTION_TOKEN`으로 `NotionClient`를 만든다
(`cli.ts:29-41`). 브라우저 Publish UI도
`operator/app/leesh-loop.mjs`에서 임시 Plan 파일을 만든 뒤 같은
`dist/src/cli.js`를 실행하므로, 두 경로가 동일한 Publisher 흐름으로
합류한다.

## canonical Plan/task 관계와 handoff

`publish()`는 Plan의 publication `Identifier`를 도출하고 task data source에서
같은 식별자의 task를 찾거나 생성한다(`publisher.ts:19-41`).
`ensureCanonicalRepresentation()`은 task가 canonical task data source에
속하는지 확인하고, Plan data source의 Plan page를 찾거나 만든다. 이어서
Plan page의 source, `Identifier`, title, 전체 본문을 검증하고 잠근 다음,
task의 `Plan` relation을 정확히 그 page 하나로 설정하고 다시 검증한다
(`notion.ts:310-338`).

따라서 task page는 실행 중 Workpad와 상태를 담고, accepted Plan 본문은
별도의 잠긴 Plan page에 보존된다. relation의 양 끝은 같은 publication
`Identifier`를 가져야 하며, 검증을 통과한 뒤 task 상태가 `Ready`로
finalize된다(`notion.ts:344-346`). 이 구조는
`docs/NOTION_PLAN_PUBLISHER.md`의 canonical publication 설명과 일치한다.

## 직접 검증

실행 명령:

```sh
npm test --prefix operator/notion_publisher
```

실제 결과: TypeScript build 성공, `tests 25`, `pass 25`, `fail 0`,
`cancelled 0`, `skipped 0`. 이 focused check는 Publisher의 canonical
Plan/task 흐름을 fake Notion client로 검증하며, live Notion publication 자체의
성공을 주장하는 검증은 아니다.
