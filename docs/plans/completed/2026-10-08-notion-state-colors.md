# 2026-10-08-notion-state-colors

## Objective

leesh-loop가 빈 Notion 데이터베이스에 최초로 Plan을 Publish할 때, 생성되는 State 옵션에 미리 정의된 색상을 적용한다.

## Intent

현재 leesh-loop는 빈 Notion 데이터베이스를 최초 Publish 시 자동 초기화하지만, State 옵션의 색상을 지정하지 않아 기본 색상으로 표시된다.

State는 작업 생명주기를 표현하는 주요 속성이므로, 새 데이터베이스에서도 각 State가 일관된 색상으로 표시되도록 한다.

기존의 자동 초기화 및 Publish 경험은 유지하며, 사용자가 매번 Notion UI에서 State 색상을 수동으로 설정할 필요가 없도록 한다.

## Verification Requirements

1. 빈 Notion 데이터베이스에서 기존 Publisher 경로로 최초 Plan을 Publish하면, 모든 기본 State 옵션이 정의된 색상으로 생성되어야 한다.
2. `Publisher Pending` 역시 정의된 색상으로 생성되어야 하며, 기존의 임시 State 사용 및 최종 State 전이 동작을 유지해야 한다.
3. State 이름과 색상의 매핑은 모든 신규 초기화에서 일관되어야 하며, 실제 Notion 데이터베이스에서도 해당 색상을 확인할 수 있어야 한다.
4. 이미 초기화된 데이터베이스에서 추가 Publish할 때 기존 State 옵션 및 사용자가 설정한 색상을 변경하지 않아야 한다.
5. 기존 State의 `Select` 타입, 기본 State 목록, task/Plan 스키마, Accepted Plan 저장 및 관계 설정, Publish 완료 및 재시도 동작을 유지해야 한다.
6. Notion API 오류와 호환되지 않는 스키마에 대한 기존 실패 처리를 유지해야 한다. 요청한 색상 초기화가 실패한 경우 이를 성공으로 간주하거나 색상 없는 초기화로 조용히 대체해서는 안 된다.

## Definitions

- **State:** leesh-loop 작업 생명주기를 나타내는 Notion `Select` 속성.
- **기본 State:** `Backlog`, `Ready`, `In Progress`, `Human Review`, `Rework`, `Merging`, `Done`, `Cancelled`.
- **임시 State:** Publish가 완료되기 전에 사용하는 `Publisher Pending`.
- **State 색상:** Notion `Select` 옵션의 `color` 값.
- **최초 초기화:** 빈 Notion 데이터베이스에 Publisher가 canonical task/Plan 스키마를 준비하는 과정.
- **기존 데이터베이스:** 이미 canonical leesh-loop 스키마가 구성되어 추가 Publish에 재사용되는 데이터베이스.

## Decisions

### State 색상 매핑

| State | Color |
|---|---|
| Backlog | `gray` |
| Ready | `blue` |
| In Progress | `yellow` |
| Human Review | `orange` |
| Rework | `red` |
| Merging | `purple` |
| Done | `green` |
| Cancelled | `gray` |
| Publisher Pending | `gray` |

Notion이 지원하는 `Select` 옵션 색상 값을 사용한다.

### 초기화 책임

State 옵션의 색상 초기화는 기존 Notion Publisher가 담당한다.

- 최초 task 스키마 생성 시 State 이름과 색상을 함께 등록한다.
- `Publisher Pending`도 최초 스키마의 State 옵션에 포함하여 색상을 지정한다.
- `Publisher Pending`은 기본 State가 아닌 임시 State로 유지한다.
- 기존 State 목록과 lifecycle 정책은 변경하지 않는다.
- 별도 설정 파일, 초기화 명령 또는 색상 관리 인터페이스는 추가하지 않는다.

### 기존 데이터베이스 처리

- 기존 State 옵션의 색상을 변경하지 않는다.
- 색상을 기존 데이터베이스의 canonical schema 호환성 조건으로 추가하지 않는다.
- 색상 마이그레이션, 기존 옵션 재생성, 자동 색상 보정은 수행하지 않는다.
- 기존 Publisher의 스키마 검증 및 재사용 동작을 유지한다.

### 보호 범위 및 명명

변경은 Publisher의 State 옵션 초기화와 이에 필요한 검증으로 제한한다.

- `leesh-loop init`, `npm start`, Operator UI의 실행 계약을 유지한다.
- State 전이, dispatch, Human Review, Merging 등 생명주기 정책을 변경하지 않는다.
- `project.toml`, `.env`, `WORKFLOW.md`, workflow template은 변경하지 않는다.
- 다른 Notion 속성이나 Plan 데이터 소스의 스키마를 변경하지 않는다.
- 기존 Publish의 복구 및 재시도 책임을 변경하지 않는다.
- 파일, 모듈, 타입 및 주요 함수 이름은 현재 책임과 역할을 드러내도록 유지하고, 존재하지 않는 추상화를 전제로 명명하지 않는다.
- 이 범위를 넘어서는 변경은 별도 계획으로 다룬다.

## Verification

### 1. 최초 초기화 및 색상 적용 (VR 1, 2, 3)

빈 Notion 테스트 데이터베이스에서 기존 Publisher 경로로 최초 Plan을 Publish한다.

- 최초 Publish가 성공하는지 확인한다.
- Notion API로 task 데이터 소스의 State 옵션을 다시 조회한다.
- 기본 State와 `Publisher Pending`이 정의된 이름과 색상으로 존재하는지 확인한다.
- Publish된 task가 최종 State인 `Ready`로 전이했는지 확인한다.
- 고정 색상 매핑 테스트로 State별 색상 정의의 일관성을 확인한다.

통과 증거: Publisher 성공 결과, 실제 Notion의 State 옵션 이름·색상 readback, 최종 task State.

### 2. 기존 데이터베이스 보존 (VR 4)

이미 초기화된 테스트 데이터베이스에서 State 색상 일부를 수동 변경한 뒤 추가 Plan을 Publish한다.

- Publish 전후 State 옵션과 색상을 비교한다.
- 기존 색상이 유지되는지 확인한다.
- 추가 Publish가 정상적으로 완료되는지 확인한다.

통과 증거: Publish 전후의 State 옵션 readback과 정상 Publish 결과.

### 3. Publish 계약 및 실패 처리 회귀 (VR 5, 6)

기존 Publisher 테스트를 활용하고 필요한 검증만 보완한다.

- State 타입과 기본 State 목록이 유지되는지 확인한다.
- task/Plan 생성, Accepted Plan 저장 및 관계 설정이 유지되는지 확인한다.
- Publish 완료 및 재시도 동작이 유지되는지 확인한다.
- 호환되지 않는 기존 스키마가 종전대로 거부되는지 확인한다.
- State 색상 초기화 요청에 Notion API 오류가 발생했을 때 성공으로 처리하거나 색상 없이 우회하지 않는지 확인한다.

통과 증거: 관련 테스트 결과와 대표적인 성공·실패 사례의 관찰 결과.

## Verification Tools

- **Node.js 테스트 러너:** 색상 매핑, 초기 스키마 요청, Publisher 회귀 검증.
- **Publisher 통합 테스트:** 최초 초기화, 기존 스키마 재사용, API 오류 처리 검증.
- **Notion API:** 실제 State 옵션, 색상, task State 및 Plan 관계 readback.
- **테스트용 Notion 데이터베이스:** 실제 최초 Publish 및 기존 DB 보존 검증.
- **기존 E2E harness:** 필요한 경우 실제 Publisher 실행 경로와 최종 결과 확인.

## Planned Work

### Notion State 색상 초기화

기존 Publisher의 최초 초기화 과정에서 기본 State와 임시 State에 고정 색상을 적용한다.

기존 데이터베이스의 State 옵션을 보존하며, Publish 및 실패 처리 계약에 대한 회귀 검증을 수행한다.

독립된 추가 작업이나 별도 마이그레이션은 도입하지 않는다.
