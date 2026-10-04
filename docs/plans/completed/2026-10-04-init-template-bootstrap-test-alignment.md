# 2026-10-04-init-template-bootstrap-test-alignment

## Objective

`leesh-loop init`의 템플릿 기반 부트스트랩 동작을 현재 책임 경계에 맞게 검증하도록 테스트를 수정한다.

`init`이 생성하는 설정과 `docs/WORKFLOW_TEMPLATE.md`에서 전달받는 worker contract를 구분하고, 템플릿 내부 문구 변경이 `init` 동작과 무관한 테스트 실패를 만들지 않도록 한다.

## Intent

현재 `operator/app/test/init.test.mjs`는 생성된 `WORKFLOW.md`를 검증하면서 `init`이 직접 생성하는 부트스트랩 설정뿐 아니라 `docs/WORKFLOW_TEMPLATE.md` 내부의 구체적인 workflow 문구까지 중복해서 고정하고 있다.

이 때문에 reusable workflow template이 정상적으로 발전해도 `init`의 부트스트랩 동작에는 문제가 없는 상태에서 `init` 테스트가 실패할 수 있다.

테스트의 관심사를 `init`이 실제로 소유하는 부트스트랩 결과와 template 전달 경계에 맞추고, workflow semantics 자체는 template의 책임으로 남긴다.

## Verification Requirements

- `init` 테스트는 생성된 `WORKFLOW.md`에 `init`이 소유하는 runtime/frontmatter 설정이 정상적으로 포함되는지를 계속 검증해야 한다.
- `docs/WORKFLOW_TEMPLATE.md`의 본문은 생성된 `WORKFLOW.md`에 현재 `init` 계약에 맞게 보존되어 포함되어야 한다.
- `init` 테스트는 template 내부의 review, Workpad, Git delivery, review confidence 등 worker contract의 구체 문구를 독립적으로 중복 검증하지 않아야 한다.
- 현재 정상적인 `init` 동작, runtime snapshot 생성, Project 설정, Notion binding, 대상 repository 비변경 보장은 기존대로 유지되어야 한다.
- 템플릿 내부의 의미적 문구가 변경되더라도 template 전달 경계가 유지되는 한 `init` 테스트가 그 변경만으로 실패하지 않아야 한다.
- 이번 작업은 테스트 계약을 정렬하는 범위로 제한하며, `operator/app/init.mjs`의 부트스트랩 동작과 `docs/WORKFLOW_TEMPLATE.md`의 worker contract 내용은 변경하지 않는다.

## Definitions

- **init-owned configuration**: `operator/app/init.mjs`가 직접 생성하는 `WORKFLOW.md`의 frontmatter 및 runtime wiring. Notion tracker 설정, workspace root, clone hook, Codex 실행 설정 등이 이에 해당한다.
- **workflow template**: `docs/WORKFLOW_TEMPLATE.md`. 생성된 Loop가 사용할 reusable worker execution contract의 본문이다.
- **template 전달 경계**: `init`이 workflow template을 읽어 생성된 `<repo>-loop/WORKFLOW.md`에 포함시키는 책임 경계.
- **template semantics**: review orchestration, Workpad, Git delivery, Human Review, Merging 등 workflow template 본문이 정의하는 worker 실행 의미.

## Decisions

- 테스트 수정은 `operator/app/test/init.test.mjs`를 중심으로 한다.
- 기존의 template semantics 문구별 assertion은 `init` 책임이 아니므로 제거하거나 template 전달 경계 검증으로 대체한다.
- `init`이 직접 생성하는 설정에 대한 assertion은 유지한다. 특히 최소한 다음 책임은 `init` 테스트에서 계속 드러나야 한다.
  - Notion tracker/database binding
  - Symphony workspace root
  - configured base branch를 사용하는 clone hook
  - `CHATGPT_SHOT_WORKER_INTERFACE_ROOT`를 포함한 Codex 실행 wiring
- template 전달은 현재 구현 계약인 `template.trim()` 이후 본문 포함을 기준으로 검증한다. byte-for-byte 파일 복제를 새로운 계약으로 도입하지 않는다.
- template 자체의 특정 문구나 세부 workflow semantics를 새 테스트로 옮겨 추가하는 작업은 이번 범위에 포함하지 않는다. 이미 별도 workflow contract 검증이 존재한다면 그 책임을 유지하며, 이번 작업에서 검증 범위를 불필요하게 확대하지 않는다.
- runtime snapshot whitelist, generated package/project, destination collision, partial cleanup, Git upstream 해석, Notion binding 관련 기존 테스트는 의미가 바뀌지 않는 한 수정하지 않는다.
- `operator/app/init.mjs`, `docs/WORKFLOW_TEMPLATE.md`, runtime 동작은 protected scope로 두고 테스트를 맞추기 위해 변경하지 않는다.
- 파일 및 테스트 이름은 현재 책임을 그대로 드러내는 기존 명칭을 유지한다. 새로운 abstraction이나 별도 helper는 테스트의 책임 경계를 명확히 하는 데 필요하지 않다면 추가하지 않는다.

## Verification

### Template 전달 경계

실제 repository의 `docs/WORKFLOW_TEMPLATE.md`를 읽어 `initLoop`로 생성한 `<repo>-loop/WORKFLOW.md`와 비교한다.

생성된 workflow의 template 영역이 현재 구현 계약인 trimmed template 전체를 그대로 포함하는지 확인한다.

이 검증이 통과하면 template 내부 문구가 무엇인지와 무관하게 현재 template이 부트스트랩 결과에 전달되었음을 증명한다.

### init-owned configuration

동일한 생성 결과에서 `init`이 직접 만드는 frontmatter/runtime wiring을 대표적으로 확인한다.

다음과 같은 실제 bootstrap 결과가 존재함을 확인한다.

- Notion tracker 설정과 `LEESH_LOOP_NOTION_DATABASE_URL`
- `SYMPHONY_WORKSPACE_ROOT`
- configured base branch를 사용하는 clone hook
- chatgpt-shot worker interface를 PATH에 연결하는 Codex command

이 검증은 template 본문에서 우연히 동일한 문자열이 등장하는지를 검사하는 것이 아니라, 생성 workflow의 bootstrap 영역이 정상적으로 조립됐음을 확인해야 한다.

### 불필요한 template coupling 제거

기존 `init.test.mjs`에서 다음 종류의 assertion이 더 이상 template 내부 문구를 고정하지 않는지 확인한다.

- `chatgpt-shot submit/jobs` 세부 문장
- 리뷰 timeout 설명 문장
- task branch / PR / direct merge 정책의 서술 문구
- Workpad 언어 정책 문구
- review 또는 workflow contract 내부 표현

template 본문을 정상적으로 수정했을 때 이러한 문구 변화만으로 `init` 테스트가 실패하지 않는 구조인지 테스트 코드를 직접 확인한다.

### 기존 init 회귀

수정된 `init` 테스트 전체를 실행해 다음 기존 보장이 계속 통과하는지 확인한다.

- configured upstream 기반 target 해석
- 독립 Loop snapshot 생성
- generated project/package 설정
- workflow path 해석
- Notion binding readback
- destination collision 보호
- 실패 시 partial destination cleanup
- runtime snapshot whitelist 및 executable preservation
- target repository working tree 비변경

가능하면 repository의 기존 `npm test` 경로도 실행하여 `init` 테스트 변경이 함께 실행되는 Operator bootstrap 테스트에 회귀를 만들지 않았음을 확인한다.

## Verification Tools

- `node --test operator/app/test/init.test.mjs`
  - 변경한 `init` 테스트와 기존 init 회귀 보장을 직접 검증한다.
- `npm test`
  - repository가 정의한 기본 테스트 진입점에서 init 및 Operator bootstrap 관련 회귀를 확인한다.
- `git diff --check`
  - 테스트 수정 diff의 whitespace 오류를 확인한다.
- 생성된 임시 `<repo>-loop/WORKFLOW.md` readback
  - 실제 `initLoop` 결과에서 init-owned configuration과 template 전달 결과를 함께 관찰한다.
