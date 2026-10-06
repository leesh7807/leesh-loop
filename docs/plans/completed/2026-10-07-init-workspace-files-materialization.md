# 2026-10-07-init-workspace-files-materialization

## Objective

`leesh-loop init`으로 생성한 Loop에서도 `project.toml`의 `workspace_files` 설정이 새 worker workspace 생성 시 정상적으로 적용되게 한다.

## Intent

현재 Generated Loop는 `project.toml`의 `workspace_files`를 읽고 runtime까지 전달하지만, `init`이 생성하는 `WORKFLOW.md`의 `after_create`가 기존 workspace file materialization을 실행하지 않아 실제 worker workspace에는 설정한 파일이 복사되지 않는다.

Source Loop와 Generated Loop가 동일한 `workspace_files` 의미를 갖게 하고, `init`으로 만든 독립 Loop에서도 기존 Project 설정 계약대로 동작하게 한다.

## Verification Requirements

- `leesh-loop init`이 생성하는 `WORKFLOW.md`의 `after_create`는 repository clone 이후 기존 workspace file materializer를 실행해야 한다.
- Generated Loop는 기존 `project.toml` → runtime environment → workspace file materializer 계약을 그대로 사용해야 하며 별도의 복사 경로나 다른 workspace file 의미를 만들지 않아야 한다.
- `workspace_files = []`인 기본 Generated Loop의 기존 동작은 유지되어야 한다.
- 기존 `workspace_files`의 경로 해석, validation, basename 복사 및 실패 의미는 변경되지 않아야 한다.
- `leesh-loop init`의 독립 snapshot, Target repository 비변경, Git upstream 해석, Generated Project 설정, Notion binding, destination collision 및 partial cleanup 동작은 변경되지 않아야 한다.
- `docs/WORKFLOW_TEMPLATE.md`의 worker contract와 Source Loop root `WORKFLOW.md`의 기존 동작은 변경되지 않아야 한다.

## Definitions

- **Generated Loop**: Target repository에서 `leesh-loop init`을 실행해 sibling directory에 생성한 독립 Loop instance.
- **Workspace file**: `project.toml`의 `workspace_files`에 지정되어 새 worker workspace root로 basename 복사되는 일반 파일.
- **Workspace file materializer**: 기존 `operator/app/workspace-files.mjs`.
- **Generated Workflow**: `init`이 Generated Loop root에 만드는 `WORKFLOW.md`.

## Decisions

- Generated Workflow의 `after_create`에서 clone 직후 기존 workspace file materializer를 실행하도록 연결한다.
- 파일 복사나 validation 로직을 `init`에 별도로 구현하지 않는다.
- `project.toml`의 `workspace_files` 형식, runtime environment 전달 방식 및 `operator/app/workspace-files.mjs`의 책임은 변경하지 않는다.
- `docs/WORKFLOW_TEMPLATE.md`는 worker contract 본문 책임으로 유지한다. 이번 수정은 init-owned frontmatter 생성 책임 안에서 처리한다.
- Source Loop root workflow, Symphony workspace lifecycle, worker dispatch, Notion lifecycle, Publisher, review flow 및 E2E orchestration은 protected scope다.
- 기존 파일과 주요 함수 이름을 유지하며 새로운 abstraction은 추가하지 않는다.

## Verification

### Generated Workflow

`initLoop`으로 생성한 `WORKFLOW.md`의 init-owned frontmatter를 확인한다.

`after_create`에서 configured repository clone 다음에 기존 `operator/app/workspace-files.mjs` 호출이 생성되는지 검증한다.

이를 통해 현재 누락된 wiring이 복구되었음을 확인한다.

### 기존 계약 회귀

기존 init focused test와 workspace file 관련 테스트를 실행한다.

기존 테스트가 계속 통과하면 다음 책임이 변경되지 않았음을 확인한다.

- Generated Project 및 workflow 생성
- workspace file validation/materialization 계약
- Git upstream 해석
- 독립 runtime snapshot
- Notion binding
- destination collision 및 partial cleanup
- Target repository 비변경

이번 수정 범위에서는 Generated Workflow를 다시 실제 Symphony dispatch하거나 별도의 live workspace 생성 E2E를 요구하지 않는다. 기존 materializer와 runtime environment 전달 경로는 이미 독립적으로 검증되고 있으므로, 누락된 Generated Workflow wiring과 관련 회귀 확인을 충분한 증거로 본다.

## Verification Tools

- `node --test operator/app/test/init.test.mjs`
  - Generated Workflow의 `after_create` wiring과 기존 init 회귀를 확인한다.
- workspace file 관련 기존 Node tests
  - 기존 materialization 및 validation 계약이 유지되는지 확인한다.
- Generated `WORKFLOW.md` readback
  - clone 이후 materializer 호출이 생성되는지 확인한다.
- `git diff --check`
  - 변경 diff의 기본 무결성을 확인한다.
