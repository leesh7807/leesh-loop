# 2026-10-06-fast-start-worker-interface

## Objective

`npm run start:fast`가 외부 readiness 검사를 생략하더라도 정상 시작과 동일한 worker 실행 계약을 유지하도록 한다.

Fast 시작으로 실행된 작업이 review 단계에 도달했을 때, 정상 시작과 같은 방식으로 `chatgpt-shot` 기능을 사용할 수 있어야 한다.

## Intent

`--skip-external-readiness`는 시작 전에 수행하는 외부 상태 검사를 생략하기 위한 옵션이다.

이 옵션 때문에 worker가 사용하는 도구, 접근 경로, 권한 경계, 책임 분리가 달라져서는 안 된다. Fast 시작은 정상 시작보다 검사를 덜 수행하는 경로이지, 다른 worker 환경이나 다른 `chatgpt-shot` 실행 방식을 사용하는 경로가 아니다.

현재는 readiness 생략과 함께 worker에 제공해야 하는 `chatgpt-shot` 실행 경계까지 빠지면서, worker가 Operator가 관리하는 외부 상태를 직접 다루는 경로로 벗어날 수 있다. 이 경계를 바로잡는다.

## Verification Requirements

1. `npm run start:fast`는 외부 readiness 검사만 생략해야 하며, dispatch된 worker의 `chatgpt-shot` 사용 계약은 `npm start`와 동일해야 한다.
2. Fast 시작으로 dispatch된 worker는 Operator가 제공하는 제한된 `chatgpt-shot` 경계를 통해 review 기능을 사용해야 하며, Operator가 소유하는 설정·상태·Service lifecycle을 직접 관리하지 않아야 한다.
3. Fast 시작 전에 필요한 외부 Service가 이미 사용 가능한 경우, worker의 `chatgpt-shot submit`과 `chatgpt-shot jobs`가 정상적인 worker 경계를 통해 동작해야 한다.
4. Fast 시작에서 필요한 외부 Service가 준비되어 있지 않다면, worker 경계에서 해당 상태를 명확한 실패로 드러내야 한다. Worker가 이를 보완하기 위해 외부 Service를 시작하거나 설정·인증·persistent state를 복구하려 해서는 안 된다.
5. 정상 `npm start`의 기존 readiness와 dispatch gating은 유지되어야 한다. Fast 경로 수정으로 정상 시작의 사전 검증 범위나 실패 기준이 약화되어서는 안 된다.
6. `leesh-loop init`으로 생성된 독립 Loop에서도 동일한 worker 실행 계약이 유지되어야 한다.
7. Readiness skip을 사용하는 E2E 경로는 기존처럼 readiness를 생략한 채 정상 기동되어야 하며, 이번 변경 때문에 E2E의 admission, resource ownership, lifecycle, 격리, 완료 판단 같은 실행 의미가 달라져서는 안 된다.

## Definitions

**External readiness**

Worker dispatch 전에 Operator가 외부 도구와 Service가 실제 작업에 사용할 수 있는 상태인지 확인하는 과정이다.

**Worker execution contract**

Dispatch된 worker에게 허용되고 제공되는 실행 환경과 도구 사용 경계다. Normal start와 fast start 사이에서 이 계약은 동일해야 한다.

**Worker-facing `chatgpt-shot`**

Worker가 review를 요청하고 결과를 읽기 위해 사용하는 제한된 `chatgpt-shot` 기능이다. Worker가 외부 Service 자체를 관리하기 위한 interface가 아니다.

**Operator-owned state**

`chatgpt-shot`의 설정, 인증 정보, browser/session 상태, Service runtime 상태 등 Operator가 소유하고 관리하는 persistent state다.

**Fast start**

`npm run start:fast`, 즉 `start`에 `--skip-external-readiness`를 적용한 실행이다.

## Decisions

### Readiness 생략과 worker 준비를 분리한다

`--skip-external-readiness`는 external readiness에만 영향을 주도록 한다.

Worker가 정상 실행 계약을 갖기 위해 필요한 준비는 normal/fast 모두에서 수행한다. 현재 하나의 조건으로 묶여 있는 두 책임을 분리하되, 별도의 fast 전용 실행 모델은 만들지 않는다.

### Normal과 fast는 같은 worker-facing `chatgpt-shot`을 사용한다

Fast 전용 `chatgpt-shot` 경로나 fallback을 추가하지 않는다.

Normal start가 worker에게 제공하는 기존 제한 interface를 fast에서도 그대로 사용한다. Worker에게 허용되는 `submit` / `jobs` 범위도 변경하지 않는다.

### Fast start는 외부 상태를 준비하거나 복구하지 않는다

Fast start에서 생략하는 readiness 작업을 worker 쪽으로 이동하지 않는다.

Fast 실행 중 필요한 Service가 없거나 사용할 수 없다면 실패를 그대로 드러낸다. 이를 이유로 worker가 `doctor`, Service start, 인증, browser/session 복구, 설정 초기화를 수행하도록 만들지 않는다.

### 권한 확대를 해결책으로 사용하지 않는다

Worker가 Operator-owned state를 직접 사용할 수 있도록 `$HOME` 또는 XDG 계열 디렉터리의 쓰기 권한을 넓히지 않는다.

이번 문제는 worker가 올바른 실행 경계를 사용하도록 수정해서 해결한다.

### 정상 시작의 readiness 계약을 보호한다

`npm start`에서 현재 수행하는 외부 설정 확인, Service readiness, smoke validation, readiness evidence와 dispatch gating은 보호 범위다.

Fast 경로를 수정하면서 normal path를 단순화하거나 검사 일부를 제거하지 않는다.

### 기존 fast entry point를 유지한다

`npm run start:fast`와 `--skip-external-readiness`는 그대로 유지한다.

새 옵션이나 별도 start command를 추가하지 않고, 현재 옵션의 실제 동작을 이름과 의도에 맞춘다.

### 기존 테스트 계약을 새 경계에 맞춘다

Fast start가 외부 readiness를 수행하지 않는다는 기존 검증은 유지한다.

다만 readiness를 생략한다는 이유로 worker 실행 준비까지 없어야 한다는 기존 기대는 제거한다. 테스트는 readiness 생략과 worker 실행 계약 보존을 서로 독립적인 조건으로 검증해야 한다.

### 독립 Loop에도 동일 계약을 반영한다

`leesh-loop init` 결과가 source checkout에 의존하지 않고 자체 runtime assets를 사용하는 현재 구조에서, 생성된 Loop에도 수정된 worker 계약이 포함되어야 한다.

한쪽 구현만 수정되어 source repository에서는 해결되지만 생성된 Loop에서는 기존 문제가 남는 상태를 허용하지 않는다.

### E2E의 실행 의미는 변경하지 않는다

E2E가 readiness skip 경로를 사용하더라도 이번 변경은 worker 실행 준비를 정상화하는 데 한정한다.

E2E의 database admission, 병렬 resource ownership, run-local runtime/port/workspace 격리, lifecycle, delivery evidence, cleanup, branch handling 및 완료 판단은 보호 범위다.

E2E를 위해 별도 worker contract나 별도 `chatgpt-shot` 동작을 추가하지 않는다.

### 보호 범위와 명명

`chatgpt-shot` 자체의 configuration 처리, Service 내부 lifecycle, submission semantics, Symphony sandbox 정책, GitHub readiness는 이번 작업에서 변경하지 않는다.

파일, 함수, 변수 이름을 변경할 필요가 있다면 readiness 검사와 worker 실행 준비라는 현재 책임이 드러나는 범위에서만 정리한다. 새로운 일반화 abstraction은 만들지 않는다.

## Verification

### VR1, VR2 — fast와 normal의 worker 실행 계약

Bootstrap 수준의 integration verification에서 normal과 fast가 dispatch하는 child의 `chatgpt-shot` 사용 경계를 비교한다.

통과 증거:

- Fast에서도 worker가 제한된 worker-facing `chatgpt-shot`을 사용할 수 있다.
- 시스템에 설치된 일반 `chatgpt-shot`이 함께 존재해도 worker는 이를 선택하지 않는다.
- Fast 여부에 따라 worker의 review command surface가 달라지지 않는다.
- Fast에서는 external readiness 관련 명령이 실행되지 않는다.

### VR2 — Operator-owned state 경계

Worker 실행 환경에서 Operator-owned config/data/cache 영역을 쓰기 불가능한 상태로 둔다.

그 상태에서도 준비된 외부 Service를 사용하는 `chatgpt-shot submit` / `jobs`가 worker-facing 경계를 통해 동작하는지 확인한다.

통과 증거:

- Worker가 Operator-owned state에 디렉터리 생성, 권한 변경, 설정 변경을 시도하지 않는다.
- 이번 장애의 `EROFS ... chmod ~/.config/chatgpt-shot`과 같은 실제 CLI 직접 실행 경로가 발생하지 않는다.

### VR3 — 준비된 Service를 사용하는 fast 실행

대표적인 Service/discovery를 bootstrap 전에 준비한 뒤 fast 경로로 worker를 dispatch한다.

Worker에서:

1. `chatgpt-shot submit`을 수행한다.
2. Job ID를 받는다.
3. `chatgpt-shot jobs <id>`로 같은 Job을 읽는다.

이 결과가 정상 worker-facing 경계를 통해 이루어진 것을 확인한다.

### VR4 — Service가 준비되지 않은 fast 실행

Service 또는 discovery가 사용할 수 없는 상태에서 fast worker의 `chatgpt-shot` 호출을 실행한다.

통과 증거:

- 기존 worker-facing failure semantics로 실패한다.
- 일반 `chatgpt-shot` CLI로 fallback하지 않는다.
- Worker가 Service 시작, 설정, 인증, browser/session 복구를 시도하지 않는다.
- Operator-owned state를 수정하려는 시도가 없다.

### VR5 — normal start regression

기존 normal bootstrap verification을 유지하여 다음 결과를 확인한다.

- readiness가 성공한 경우에만 worker가 dispatch된다.
- 필요한 Service preparation과 smoke validation이 계속 수행된다.
- readiness 실패 시 worker가 dispatch되지 않는다.
- 정상 worker-facing `chatgpt-shot` 사용 경계가 유지된다.

### VR6 — 독립 Loop

`leesh-loop init`의 focused verification에서 생성된 독립 Loop가 수정된 bootstrap/runtime 계약을 포함하는지 확인한다.

생성된 Loop에서 fast start가 source repository에 의존하지 않고 동일한 worker-facing `chatgpt-shot` 경계를 제공하는 것을 확인한다.

### VR7 — E2E regression

Readiness skip을 사용하는 기존 E2E focused test를 실행한다.

통과 증거:

- E2E가 기존처럼 external readiness를 실행하지 않고 기동된다.
- Worker 실행 준비가 추가되더라도 E2E의 admission과 run lifecycle이 달라지지 않는다.
- 기존 resource isolation과 run-local runtime 경계가 유지된다.
- E2E를 위한 별도 review semantics나 Service lifecycle이 생기지 않는다.

이번 변경의 검증을 위해 새로운 전체 E2E workflow 의미를 추가하지 않는다. 기존 readiness-skip 경로의 회귀 여부만 확인한다.

### Repository regression

관련 focused tests와 전체 repository test suite를 실행한다.

최종적으로 `git diff --check`와 diff inspection을 통해:

- 변경이 readiness와 worker 실행 경계 분리에 한정되는지,
- normal start, init, E2E 또는 `chatgpt-shot` worker contract에 불필요한 변경이 없는지 확인한다.

## Verification Tools

- `operator/app/test/operator_bootstrap.test.mjs`: normal/fast bootstrap의 readiness와 worker 실행 계약을 함께 검증한다.
- `operator/app/test/chatgpt_shot_worker.test.mjs`: worker-facing `submit` / `jobs` 동작과 failure boundary를 검증한다.
- `operator/app/test/start_cli.test.mjs`: normal/fast가 같은 start 경로를 사용하고 fast만 readiness skip을 적용하는지 검증한다.
- init focused tests: 생성된 독립 Loop가 동일 worker 실행 계약을 갖는지 검증한다.
- E2E focused tests: readiness skip 경로가 기존 E2E 의미를 보존한 채 계속 동작하는지 검증한다.
- Prepared Service/discovery integration fixture: fast worker가 정상 worker-facing 경계를 통해 `submit` / `jobs`를 사용할 수 있는지 검증한다.
- Read-only Operator-state fixture: worker가 Operator-owned persistent state에 직접 접근하지 않는지 검증한다.
- `npm test`, 관련 E2E tests, `git diff --check`, final diff inspection: 전체 회귀와 변경 범위를 검증한다.
