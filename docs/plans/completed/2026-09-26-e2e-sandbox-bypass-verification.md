# 2026-09-26-e2e-sandbox-bypass-verification

## Objective

현재 이 Accepted Plan을 실행 중인 Symphony Codex worker에서 `npm run e2e`에 설정한 sandbox bypass가 실제로 적용되어, E2E가 기존 nested sandbox 실패 지점을 넘어 내부 Symphony worker의 실제 실행 단계까지 도달함을 증명한다.

## Intent

이 계획을 실행하는 주체는 이미 Operator가 dispatch한 실제 Symphony Codex worker다.

따라서 별도의 외부 worker를 만들거나, 다른 shell에서 검증 환경을 재현하거나, 검증용 Symphony 실행을 새로 구성하지 않는다. 현재 이 작업을 수행하고 있는 worker 안에서 실제 `npm run e2e`를 실행해 검증한다.

현재 이 worker는 Codex sandbox 안에서 동작한다. 여기서 `npm run e2e`를 일반 명령처럼 실행하면 E2E가 다시 Symphony worker와 Codex sandbox를 생성하면서 nested sandbox 문제가 발생한다.

이를 해결하기 위해 `npm run e2e`만 명시적으로 현재 worker의 Codex sandbox 바깥에서 실행하도록 허용하려고 한다.

이번 작업의 목적은 현재 worker에서 실제 `npm run e2e`를 실행했을 때 이 bypass가 의도대로 적용되어, 기존에 실패하던 nested sandbox 생성 구간을 실제 E2E가 통과하는지 확인하는 것이다.

별도의 probe 경로를 만들어 이를 대신하지 않는다. 실제 `npm run e2e` 경로를 그대로 사용한다.

## Verification Requirements

1. 검증은 현재 이 Accepted Plan을 실행 중인 Symphony Codex worker에서 수행한다.
2. 별도의 worker나 별도 Symphony 실행 환경을 검증용으로 만들지 않는다.
3. worker 전체의 sandbox를 비활성화하지 않는다. 일반 worker 명령은 기존과 같이 Codex sandbox 안에서 실행되어야 한다.
4. 실제 `npm run e2e`를 실행하여 검증한다.
5. E2E가 기존 nested sandbox 실패가 발생하던 내부 worker 생성 구간을 통과해야 한다.
6. 내부 Symphony worker가 생성된 뒤 실제 Codex command execution 단계까지 도달했음을 확인한다.
7. 단순히 `npm run e2e` 프로세스가 시작됐거나 기존 오류 문자열이 보이지 않았다는 사실만으로 통과시키지 않는다.
8. 검증을 위해 E2E lifecycle을 별도 mock, probe, 축소 실행 경로로 대체하지 않는다.
9. 변경 후에도 일반 worker 명령은 기존 Codex sandbox 안에서 실행됨을 확인한다.

## Decisions

### 1. 현재 worker를 검증 주체로 사용한다

이 계획을 받은 worker가 곧 검증 대상의 outer worker다. 별도 worker나 검증용 Symphony 실행을 만들지 않는다.

검증 흐름은 다음과 같다.

```text
current Symphony Codex worker
→ npm run e2e
→ explicit sandbox bypass
→ E2E
→ inner Symphony worker 생성
→ inner Codex sandbox 생성
→ inner worker command execution
```

### 2. 실제 E2E 경로를 검증한다

검증 대상은 실제 사용하려는 명령 `npm run e2e`다. 별도의 sandbox 검증 command를 추가하지 않는다.

### 3. 기존 실패 경계를 검증 기준으로 사용한다

현재 문제는 E2E가 내부 Symphony worker를 만들면서 다시 Codex sandbox를 생성하는 지점에서 발생한다. bypass 검증은 해당 경계를 실제 E2E가 통과했는지로 판단한다.

### 4. E2E 전체 성공과 sandbox bypass 검증을 구분한다

이번 작업에서 필요한 것은 E2E 전체 lifecycle의 성공이 아니라, sandbox bypass 때문에 막혀 있던 실행 경계를 통과하는 것이다. 해당 지점 이후 별도의 E2E application-level failure가 발생하더라도 sandbox bypass 검증 결과와 구분한다.

## Verification

### 1. Current worker context

현재 실행 주체가 이 Accepted Plan을 받은 Symphony Codex worker임을 기존 task/workspace execution context로 확인한다.

### 2. Normal command baseline

현재 worker에서 일반 명령이 기존 Codex sandbox 안에서 실행되고 있음을 확인한다. 필요한 경우 현재 nested sandbox 문제가 발생하는 기존 실행 조건을 baseline으로 확인한다.

### 3. Actual E2E execution

현재 worker에서 다음을 실행한다.

```text
npm run e2e
```

E2E가 기존 실행 경로를 따라 진행하도록 둔다.

### 4. Nested sandbox boundary 확인

E2E가 내부 Symphony worker를 생성하고, 해당 worker의 Codex sandbox 생성이 정상적으로 완료되는지 확인한다. 기존에 발생하던 nested sandbox failure에서 중단되어서는 안 된다.

### 5. Inner worker execution 확인

내부 worker가 실제 Codex command execution에 도달했음을 기존 로그, lifecycle state, worker output 또는 현재 구현이 제공하는 실행 evidence로 확인한다. 단순히 내부 프로세스가 생성됐다는 사실만으로는 충분하지 않다.

### 6. Failure classification

`npm run e2e`가 이후 다른 이유로 실패한다면 실패 지점을 확인한다. 내부 worker command execution 이후 발생한 application-level 실패는 sandbox bypass 실패와 구분한다.

### 7. Sandbox preservation

변경 후 현재 worker의 일반 명령이 여전히 기존 Codex sandbox 안에서 실행됨을 확인한다.

## Completion Criteria

다음이 모두 확인되면 완료다.

- 검증은 현재 이 Accepted Plan을 실행 중인 Symphony Codex worker에서 수행됐다.
- 일반 worker 명령은 기존 Codex sandbox 안에서 실행된다.
- 실제 `npm run e2e`가 실행됐다.
- E2E가 기존 nested sandbox 실패 지점을 통과했다.
- 내부 Symphony worker의 Codex sandbox가 정상 생성됐다.
- 내부 worker가 실제 Codex command execution 단계까지 도달했다.

E2E가 그 이후 별도의 application-level 문제로 실패하는 것은 이 sandbox bypass 검증의 실패로 보지 않는다.
