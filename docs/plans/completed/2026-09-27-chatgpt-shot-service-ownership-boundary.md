# 2026-09-27-chatgpt-shot-service-ownership-boundary

## Objective

leesh-loop의 bootstrap이 chatgpt-shot readiness를 확인하고 필요한 경우 public startup 경로를 사용할 수는 있되, 기존 chatgpt-shot Service를 중지하거나 교체하는 recovery lifecycle에는 개입하지 않도록 ownership 경계를 정리한다.

external readiness를 수행하는 startup에서 chatgpt-shot readiness가 최종적으로 충족되지 않으면 leesh-loop bootstrap은 worker dispatch 전에 실패한다. 이 실패를 복구하기 위해 기존 chatgpt-shot Service를 중지하거나 discovery를 제거한 뒤 다시 시작하지 않는다.

external readiness 자체를 수행하지 않아야 하는 실행은 기존 `skip_external_readiness` 경계를 사용한다.

## Intent

현재 leesh-loop는 시작 단계에서 chatgpt-shot configuration, browser/session, Service readiness와 실제 smoke submission을 확인한 뒤 worker를 dispatch한다. worker-facing interface는 이후 준비된 Service에 대해 `submit`과 `jobs`만 사용할 수 있도록 제한되어 있다.

이 구조에서 startup readiness는 “leesh-loop가 작업을 시작할 수 있는가”를 판단하기 위한 경계다.

leesh-loop가 정상 startup 과정에서 chatgpt-shot의 public start/preparation command를 사용하는 것은 허용한다. 그러나 readiness 판정 실패를 근거로 기존 Service를 `stop`하고 discovery가 사라지기를 기다린 뒤 다시 시작하는 recovery protocol은 leesh-loop가 소유할 책임이 아니다.

현재 bootstrap은 자체 Service readiness 판정이 실패하면 `chatgpt-shot stop`을 호출하고 discovery가 사라지기를 기다린 뒤 다시 Service를 준비한다. 이 때문에 leesh-loop startup이 자신이 소유하지 않는 기존 chatgpt-shot Service lifecycle에 개입한다.

의도하는 경계는 다음과 같다.

- external readiness가 활성화된 경우 leesh-loop는 chatgpt-shot readiness가 충족된 뒤에만 worker를 dispatch한다.
- 정상 startup에서 Service가 필요하면 chatgpt-shot이 제공하는 public startup/preparation 경로를 사용할 수 있다.
- startup/preparation 이후에도 readiness가 충족되지 않으면 leesh-loop는 자신의 bootstrap을 실패시킨다.
- leesh-loop는 readiness 실패를 근거로 기존 Service를 중지하거나 discovery를 제거·교체하지 않는다.
- 기존 Service의 stop/restart/replacement 및 discovery cleanup lifecycle은 chatgpt-shot이 소유한다.
- external readiness 자체가 필요하지 않은 실행은 기존 `skip_external_readiness`를 통해 이 경계를 명시적으로 우회한다.
- worker-facing interface는 기존대로 `submit`과 `jobs`만 사용한다.
- 이번 변경은 chatgpt-shot 자체의 lifecycle 정책을 새로 설계하는 작업이 아니라 leesh-loop가 구성한 destructive recovery protocol을 제거하는 작업이다.

## Verification Requirements

1. bootstrap의 readiness failure 처리 경로에서 `chatgpt-shot stop` 또는 그와 동등한 기존 Service shutdown 요청이 없어야 한다.
2. bootstrap은 readiness recovery를 위해 discovery 삭제를 기다리거나 기존 Service replacement 절차를 구성해서는 안 된다.
3. external readiness가 활성화된 상태에서 startup/preparation 이후 readiness가 최종적으로 충족되지 않으면 bootstrap은 실패하고 worker를 dispatch하지 않아야 한다.
4. 정상 startup에서 기존 public Service startup/preparation 경로와 readiness/smoke 흐름은 변경하지 않는다.
5. worker-facing `submit`/`jobs` 제한과 `skip_external_readiness`의 기존 의미는 변경하지 않는다.

## Definitions

### chatgpt-shot Service

Operator 환경에서 실행되며 chatgpt-shot Job admission과 조회를 제공하는 local Service.

### discovery

chatgpt-shot이 Service endpoint와 identity를 제공하기 위해 관리하는 runtime metadata. 현재 대표적인 저장 위치는 `runtime.json`이다.

### readiness

leesh-loop가 자신의 startup을 계속해도 되는지를 판단하는 조건.

external readiness가 활성화된 경우 readiness 충족은 worker dispatch의 전제 조건이다. startup/preparation 이후에도 readiness가 충족되지 않으면 leesh-loop bootstrap은 실패한다.

readiness 실패는 기존 Service를 중지하거나 교체하는 recovery 권한을 의미하지 않는다.

### lifecycle recovery mutation

기존 Service의 stop, restart, replacement 또는 recovery를 위한 discovery 삭제처럼 이미 존재하는 Service 상태를 변경하는 동작.

정상 startup에서 public command를 통해 필요한 Service를 시작하는 동작 자체는 이번 계획에서 금지하지 않는다.

### worker-facing interface

Symphony worker에 제공되는 제한된 chatgpt-shot interface. 현재 계약상 `submit`과 `jobs`만 허용한다.

## Decisions

### Ownership boundary

leesh-loop는 chatgpt-shot readiness의 consumer이며 기존 Service recovery lifecycle의 authority가 아니다.

bootstrap에서 readiness failure를 처리하기 위해 기존 Service를 stop하고 다시 시작하는 recovery 정책은 제거한다.

external readiness가 활성화된 startup에서는 readiness 상태를 관측하고, 최종적으로 준비되지 않은 경우 worker dispatch 전에 bootstrap을 실패시킨다. readiness 실패를 근거로 기존 Service에 destructive recovery action을 수행하지 않는다.

readiness 검사를 우회해야 하는 실행은 lifecycle recovery를 추가하는 대신 기존 `skip_external_readiness`를 사용한다.

### Startup and preparation boundary

정상 startup에서 Service가 필요하면 chatgpt-shot이 제공하는 기존 public startup/preparation command를 사용할 수 있다.

public startup/preparation 이후 필요한 readiness와 smoke 조건이 충족되면 기존과 같이 startup을 계속한다.

해당 조건이 최종적으로 충족되지 않으면 bootstrap은 실패하며 worker를 dispatch하지 않는다.

readiness failure 이후 `stop → discovery cleanup 대기 → start` 같은 recovery protocol을 leesh-loop가 직접 구성하지 않는다.

기존 public command만으로 필요한 정상 startup을 표현하기 어렵다면 부족한 capability는 chatgpt-shot 쪽 책임으로 다루고, leesh-loop에 destructive recovery authority를 추가하지 않는다.

### Discovery ownership

`runtime.json`의 생성, 교체, stale 판정, 삭제는 chatgpt-shot의 책임으로 유지한다.

leesh-loop는 discovery를 readiness 판단에 사용할 수 있지만 recovery cleanup protocol의 일부로 삭제하거나 삭제 대기를 수행하지 않는다.

### Protected scope

다음은 이번 계획에서 변경하지 않는다.

- worker Job submission 및 result readback semantics
- worker-facing `submit`/`jobs` 제한
- chatgpt-shot Job persistence 및 Notion Invocation semantics
- chatgpt-shot 자체의 `start`/`stop` 명령 의미
- 사용자가 명시적으로 수행하는 chatgpt-shot lifecycle 관리
- Symphony task lifecycle
- `skip_external_readiness`의 기존 의미
- browser/session implementation
- chatgpt-shot 내부 discovery 포맷 및 cleanup algorithm

chatgpt-shot 자체의 별도 lifecycle defect가 발견되더라도 이번 ownership 경계 수정에 필요하지 않다면 별도 계획으로 분리한다.

### Naming

수정되는 파일, 함수, 타입, 테스트 이름은 readiness 확인과 기존 Service recovery lifecycle 관리의 책임 차이를 드러내야 한다.

존재하지 않는 새로운 supervisor나 service manager abstraction을 전제로 이름을 만들지 않는다.

## Verification

### 1. lifecycle recovery 제거 및 failure 경계 확인

변경된 bootstrap 구현과 가장 직접적인 focused test에서 다음을 확인한다.

- readiness failure 처리 경로에서 `chatgpt-shot stop` 호출이 없다.
- discovery 삭제를 기다리는 recovery loop가 없다.
- 기존 Service를 stop한 뒤 다시 시작하는 replacement/restart 절차가 없다.
- startup/preparation 이후 readiness가 최종 실패하면 bootstrap이 실패한다.
- 이 경우 worker dispatch에 도달하지 않는다.

실제 Service를 중단시키는 live failure scenario를 별도로 만들 필요는 없다.

### 2. 정상 경로 회귀 확인

기존 bootstrap focused test가 있다면 정상 public startup/preparation 및 readiness/smoke 성공 경로가 그대로 유지되는지만 확인한다.

별도의 live startup 실행은 완료 조건으로 요구하지 않는다.

### 3. 보호된 경계 확인

기존 관련 test가 이미 있다면 다음 계약이 변경되지 않았는지 함께 확인한다.

- worker-facing interface는 `submit`과 `jobs`만 허용한다.
- `skip_external_readiness`는 기존과 동일하게 external readiness 전체를 우회한다.

이번 변경 때문에 새로운 별도 검증 경로나 live E2E를 추가할 필요는 없다.

## Verification Tools

- `operator/app/operator-bootstrap`
  - readiness failure 처리에서 `stop`, discovery cleanup wait, Service replacement 경로가 제거되었는지 확인한다.
  - readiness가 최종적으로 충족되지 않을 때 bootstrap이 worker dispatch 전에 실패하는지 확인한다.
- bootstrap focused tests
  - 정상 startup 경로는 유지되고 failure recovery에서는 lifecycle mutation 없이 bootstrap이 실패하는지 확인한다.
- 기존 worker-wrapper / external-readiness tests
  - 변경 영향이 있는 경우에만 `submit`/`jobs` 및 `skip_external_readiness` 회귀를 확인한다.
