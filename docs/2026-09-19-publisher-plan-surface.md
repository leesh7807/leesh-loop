# Publisher Plan 표면 조사

## 관찰된 Publisher 진입점

문서상 CLI 진입점은 `operator/notion_publisher`에서 빌드된 `dist/src/cli.js`다.

```sh
node dist/src/cli.js \
  --plan /path/to/plan.md \
  --config /path/to/publisher-config.json \
  --database-url https://www.notion.so/Tasks-3d28a26586258052b3ecccc9c33787e3
```

`cli.ts`는 Plan 파일을 UTF-8로 읽고 설정을 해석한 뒤 `publishPlanFile`에서
`publish({ plan, databaseUrl, fallbackTitle, client, config })`를 호출한다. CLI 실행에는
`NOTION_TOKEN`이 필요하며, 실제 publication 로직의 경계는 `publisher.ts`의 `publish`다.

## canonical Plan/task 관계

- Publisher는 명시된 Notion database container의 data source schema를 구조적으로 확인해
  task data source와 sibling Plan data source를 결정한다. task의 `Plan` relation은 해당
  Plan data source를 대상으로 하는 단일 relation이어야 한다.
- task와 Plan page는 같은 publication `Identifier`를 가진다. task의 `Plan` property는
  정확히 하나의 Plan page를 가리키고, 그 page는 Plan data source에 속하며 동일한
  `Identifier`와 제목을 가져야 한다.
- 완전한 Accepted Plan 본문은 Plan page에만 기록하고 검증한 뒤 page를 잠근다. task
  page의 body는 별도의 mutable Workpad 표면이며 publication 직후에는 비어 있다.
- task는 처음 `Publisher Pending`으로 생성·복구되고, Plan 내용·잠금·relation·식별자를
  모두 검증한 다음 `Ready`로 최종화된다. 이 `Ready` handoff가 이후 worker 실행의
  시작점이다.

근거: `docs/NOTION_PLAN_PUBLISHER.md`, `operator/notion_publisher/src/cli.ts`,
`operator/notion_publisher/src/publisher.ts`, `operator/notion_publisher/src/notion.ts`.

## focused verification

실행한 명령:

```sh
cd operator/notion_publisher && npm test
```

실제 결과: TypeScript build 성공, Publisher 테스트 25개 통과, 0개 실패
(`tests 25`, `pass 25`, `fail 0`). 이 검증은 fake Notion provider를 사용한 저장소
테스트이며, live Notion publication이나 credential 변경은 수행하지 않았다.
