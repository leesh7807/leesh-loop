# 2026-09-22-external-readiness-boundary

## Objective

Operator startup에서 worker workspace 밖의 Operator-owned external state readiness를 나머지 Symphony startup readiness와 분리하고, Project의 `skip_external_readiness: true`로 그 external readiness만 생략한다. Production E2E는 별도 runtime이나 startup 경로 없이 기존 Publisher → Operator → Symphony → worker 경로를 사용한다.

## Intent

Production E2E가 Symphony worker sandbox 안에서 실행될 때 `chatgpt-shot` configuration/data/cache, browser/session, Service lifecycle과 같은 workspace 밖 상태를 읽을 수 없어도 nested Symphony production startup과 dispatch readiness까지 도달해야 한다. E2E 전용 launcher나 worker 권한 확장은 사용하지 않는다.

## Verification Requirements

1. `skip_external_readiness`가 켜진 기존 `leesh-loop.mjs start` 경로가 external `chatgpt-shot` state 없이 core readiness, Symphony startup, dispatch authorization/acknowledgement까지 진행한다.
2. GitHub network/authentication, configured base branch bootstrap/readback, workspace root, Publisher, Symphony startup, dispatch barrier는 skip 대상이 아니다.
3. Production E2E는 run-local Operator Project에 `skip_external_readiness: true`를 쓰고 기존 `leesh-loop.mjs start` → `operator-bootstrap` → Symphony production 경로를 사용한다.
4. external readiness 수행/생략 값은 effective runtime configuration과 compatibility 판정에 포함되어 서로 재사용되지 않는다.
5. worker sandbox policy, `WORKFLOW.md` lifecycle/review contract, Publisher 책임, configured-base readiness, dispatch semantics는 변경하지 않는다.

## Definitions

* **External readiness**: workspace root 밖의 Operator-owned `chatgpt-shot` configuration/data/cache, browser/session, Service lifecycle, smoke Job, worker-facing interface와 그 직접 종속 readiness.
* **Core startup readiness**: workspace root, GitHub authentication/network, configured base branch bootstrap/readback, Publisher 준비, Symphony runtime startup, dispatch authorization/acknowledgement.
* **External readiness skip path**: `skip_external_readiness: true`가 `--skip-external-readiness`로 전달되어 external readiness만 수행하지 않는 일반 Operator startup 경로.

## Decisions

* Project configuration 이름은 `skip_external_readiness`로 고정하고 boolean만 허용한다. omitted/false는 기존 external readiness를 수행한다.
* `leesh-loop.mjs`는 true일 때만 `operator-bootstrap --skip-external-readiness`를 전달한다.
* skip path는 external capability가 준비되었다는 discovery/interface/readiness evidence를 만들지 않는다.
* `skip_external_readiness`는 effective runtime identity에 포함한다. true와 false runtime은 compatible runtime으로 재사용하지 않는다.
* Production E2E는 run-local Operator Project 생성 시 true를 설정하고 `OperatorClient` 및 기존 `leesh-loop.mjs start` entry point는 유지한다.
* `operator/project.example.json`은 기본 production 경로 예제로 유지한다.
* `operator/symphony/`, `WORKFLOW.md`, worker sandbox, Publisher, GitHub/configured-base readiness, dispatch barrier, E2E lifecycle/evidence 계약은 수정하지 않는다.

## Verification

* external state 경로를 사용할 수 없고 `chatgpt-shot` 실행도 허용하지 않는 fake-command 환경에서 실제 `operator-bootstrap --skip-external-readiness`가 core GitHub/base checks와 child startup까지 도달하며 external command/side effect가 없음을 확인한다.
* Operator app tests에서 boolean validation, bootstrap flag 전달, effective identity/compatibility를 확인한다.
* E2E orchestration test에서 생성된 run-local `project.json`의 true 값을 확인하고 기존 Operator client entry point를 유지한다.
* `npm test --prefix operator/e2e`, 관련 Operator tests, `git diff --check`를 실행한다.
* 가능한 환경에서 `node operator/e2e/cli.mjs run operator/e2e/project.json`의 실제 production path와 run record/runtime evidence를 확인한다. 외부 credential/state 또는 live E2E가 불가능하면 정확한 표면별 제한을 기록한다.

## Verification Tools

* `operator/app/operator-bootstrap`: external skip와 core startup 경계 및 side effect 관찰.
* `leesh-loop.mjs` runtime state/effective identity: flag 전달과 compatibility 관찰.
* E2E run-local `project.json` 및 `runs/<run-id>/run.json`: production path 설정/evidence 관찰.
* `npm test --prefix operator/e2e`, `node --test operator/app/test/*.test.mjs`, `git diff --check`.

## chatgpt-shot review log
