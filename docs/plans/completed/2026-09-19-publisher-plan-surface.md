# 2026-09-19-publisher-plan-surface

## Objective

저장소의 canonical Plan publication과 task handoff를 조사하고, 관찰된 Publisher 진입점·canonical Plan/task 관계·구체적인 검증 명령 하나를 설명하는 간결한 한국어 조사 노트를 `docs/` 아래에 작성한다. Production behavior와 credentials는 변경하지 않는다.

## Intent

Accepted Plan이 요구한 범위 안에서 Publisher가 Plan을 Notion task에 handoff하는 실제 경로와 두 canonical record의 연결 방식을 저장소 근거로 남긴다.

## Verification Requirements

- `docs/` 아래 조사 노트가 한국어로 존재해야 한다.
- 노트는 관찰된 Publisher entry point와 canonical Plan/task relationship을 실제 코드 및 문서와 일치하게 설명해야 한다.
- 노트에는 실행 가능한 구체적인 verification command와 그 실제 결과가 기록되어야 한다.
- Production behavior와 credentials에는 변경이 없어야 한다.

## Definitions

- **Publisher entry point**: `operator/notion_publisher/src/cli.ts`의 CLI `main()`에서 `publishPlanFile()`을 호출하는 실행 경로.
- **Canonical Plan/task relationship**: task data source의 `Plan` relation이 동일 publication `Identifier`를 가진 별도 Plan data source의 Plan page를 가리키는 관계.

## Decisions

- 조사 결과는 기존 Publisher 문서와 소스의 관찰만 간결한 한국어 노트로 기록한다.
- 파일 및 주요 함수 이름은 현재 책임을 드러내는 기존 이름을 그대로 사용한다.
- Production behavior, credentials, `operator/symphony/`는 변경 대상에서 제외한다.

## Verification

Publisher 패키지의 직접적인 focused check를 실행하고, 조사 노트에 명령과 실제 pass/fail 결과를 기록한다. 최종 diff와 `git diff --check`로 문서 변경의 무결성도 확인한다.

## Verification Tools

- `docs/NOTION_PLAN_PUBLISHER.md`와 `operator/notion_publisher/src/`의 직접 소스 조사: 진입점과 Plan/task 관계의 근거 확인.
- `cd operator/notion_publisher && npm test`: Publisher build 및 25개 focused test의 실제 결과 확인.
- `git diff --check`: 문서 diff의 whitespace 오류 확인.
