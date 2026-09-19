# 2026-09-19-workspace-contract-surface

## Objective

이 저장소의 workspace bootstrap과 Git target contract를 조사하고, 설정된 base가 worker workspace에 도달하는 경로와 구체적인 isolation 또는 readiness risk 하나를 설명하는 간결한 한국어 조사 노트를 `docs/` 아래에 만든다. Production behavior와 credential은 변경하지 않는다.

## Intent

Operator/Symphony 경계에서 Project의 Git target 설정, readiness, `after_create` hook, 새 workspace 준비 조건이 어떻게 연결되는지 실제 코드와 workflow에서 확인한다.

## Verification Requirements

- 조사 노트가 설정된 repository URL/base branch에서 worker workspace까지의 실제 경로를 파일·라인 근거와 함께 설명해야 한다.
- 하나의 구체적인 isolation 또는 readiness risk에 trigger, 영향, 재현 가능한 실행 경로를 포함해야 한다.
- 가장 직접적인 focused check의 실제 결과를 기록해야 한다.
- `operator/symphony/`와 credential을 변경하지 않아야 한다.

## Definitions

- **Git target**: Project의 `github_repository_url`과 `github_base_branch` 쌍.
- **Worker workspace**: Symphony가 issue별로 생성·재사용하고 `after_create` hook을 실행하는 작업 디렉터리.
- **Configured base**: Git target의 base branch와 그 remote commit.

## Decisions

- 이번 작업은 조사 문서와 실행 증거만 추가하고 production behavior는 수정하지 않는다.
- Repository Plan은 이 Accepted Plan의 실행 경계를 보존하며, routine command log를 담지 않는다.
- 검증은 Git target bootstrap 테스트와 workflow의 실제 `after_create` shell sequence를 포함하는 가장 가까운 focused Node test로 수행한다.

## Verification

`operator/app/test/git_target.test.mjs`와 `operator/app/test/workspace_files.test.mjs`를 실행하여 configured base의 read/create/readback, 설정 전달, 그리고 clone 후 `after_create` materialization 순서를 확인한다. 조사 노트의 risk는 Symphony의 workspace 생성·재사용 및 hook 호출 조건을 직접 읽어 근거화한다.

## Verification Tools

- `rg`, `sed`, `nl`: 설정·workflow·workspace 구현의 실제 경로와 라인 근거 확인.
- `node --test operator/app/test/git_target.test.mjs operator/app/test/workspace_files.test.mjs`: Git target 및 workspace bootstrap focused check.
- `git diff --check`: 문서 변경의 whitespace 오류 확인.
