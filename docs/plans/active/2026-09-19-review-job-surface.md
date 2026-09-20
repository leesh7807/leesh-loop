# 2026-09-19-review-job-surface

## Objective

저장소의 worker-facing independent review 경계를 조사하고, submit/readback 계약과 terminal result에 보존되는 evidence를 설명하는 간결한 한국어 조사 문서를 `docs/` 아래에 추가한다.

## Intent

리뷰 Job의 제출 결과와 terminal result를 혼동하지 않고, worker가 실제로 호출하는 두 명령과 결과 증거의 소유 위치를 확인할 수 있어야 한다.

## Verification Requirements

- 조사 문서가 `chatgpt-shot submit "<prompt>"`의 제출 계약을 설명해야 한다.
- 조사 문서가 `chatgpt-shot jobs <job-id>`의 readback 계약을 설명해야 한다.
- 조사 문서가 terminal result에 대해 보존되는 review binding과 결과 evidence를 설명해야 한다.
- 조사 문서에 focused check 명령과 그 실제 결과를 기록해야 한다.
- production behavior와 credentials는 변경하지 않는다.

## Definitions

- **Review Job**: 독립 리뷰 요청을 비동기로 처리하는 서비스 측 작업이다.
- **submit**: review prompt를 Job으로 등록하고 Job ID를 반환하는 worker-facing 명령이다.
- **readback**: Job ID로 현재 `state`, `result`, `error`를 조회하는 worker-facing 명령이다.
- **terminal result**: Job이 `completed` 또는 `failed`에 도달했을 때의 결과 또는 오류 evidence다.

## Decisions

- 조사 범위는 `operator/external/chatgpt-shot/chatgpt-shot`, 해당 focused test, 그리고 root `WORKFLOW.md`의 independent review contract로 한정한다.
- 실제 서비스/browser를 관리하지 않고 worker-facing 명령의 관찰 가능한 입출력만 기록한다.
- 문서와 Repository Plan만 변경하며 production code와 credentials는 변경하지 않는다.
- 파일 이름은 책임이 드러나도록 `docs/review-job-surface.md`를 사용한다.

## Verification

- `node --test operator/app/test/chatgpt_shot_worker.test.mjs`로 submit/readback 요청 형식, bearer 전달, completed snapshot, unsupported command와 invalid Job ID 처리를 확인한다.
- `git diff --check`와 최종 diff inspection으로 문서 변경만 남았는지 확인한다.

## Verification Tools

- `operator/external/chatgpt-shot/chatgpt-shot`: worker-facing submit/readback 경계의 실제 구현.
- `operator/app/test/chatgpt_shot_worker.test.mjs`: 로컬 HTTP 서비스 경유의 focused contract test.
- `WORKFLOW.md`: Job ID binding, polling, terminal result, Human Review handoff의 운영 계약.
