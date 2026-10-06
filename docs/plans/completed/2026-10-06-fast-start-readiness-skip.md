# 2026-10-06-fast-start-readiness-skip

## Objective

`leesh-loop`을 빠르게 다시 열고 싶을 때 `npm run start:fast`로 기존 external readiness 검사를 생략해 시작할 수 있게 한다.

## Intent

일반 `npm start`의 안전한 기본 동작은 유지하되, 이미 `chatgpt-shot`을 사용 중이어서 상태를 신뢰할 수 있는 상황에서는 긴 readiness 확인을 반복하지 않고 짧은 명령으로 시작하고 싶다.

새로운 readiness 개념이나 별도 설정 체계를 만들기보다, 이미 존재하는 skip 동작을 편의 진입점에서 재사용한다.

## Verification Requirements

- `npm start`는 현재와 동일하게 external readiness를 수행해야 한다.
- `npm run start:fast`는 기존 `--skip-external-readiness` 동작을 사용해 external readiness를 생략해야 한다.
- `start:fast`는 readiness 생략 외에는 일반 `start`와 동일한 프로젝트 설정과 시작 경로를 사용해야 한다.
- fast start가 기존 `skip_external_readiness` 계약과 별개의 새로운 skip 의미를 만들지 않아야 한다.
- 잘못된 fast-start 인자 처리로 config 경로가 바뀌거나 일반 시작 동작이 깨지지 않아야 한다.

## Definitions

- **normal start**: 현재의 `npm start`.
- **fast start**: `npm run start:fast`.
- **external readiness**: 현재 `operator-bootstrap`이 `--skip-external-readiness`로 생략할 수 있는 기존 readiness 영역.
- **skip**: 해당 readiness를 이번 시작에서 수행하지 않는 기존 동작. 별도의 readiness 성공으로 간주하는 의미는 아니다.

## Decisions

- fast start는 기존 `--skip-external-readiness` 경로를 그대로 재사용한다.
- 사용자-facing 편의 진입점 이름은 `start:fast`로 한다.
- `operator/project.json`의 지속 설정을 바꾸는 방식은 사용하지 않는다. fast start는 실행 단위 선택으로 유지한다.
- `npm start`의 기존 의미와 기본 동작은 보호 범위로 두며 변경하지 않는다.
- external readiness 자체의 범위, `operator-bootstrap` 내부 동작, `chatgpt-shot` readiness 정책은 이번 계획의 보호 범위로 두며 변경하지 않는다.
- fast start 지원을 위해 필요한 최소한의 CLI 전달만 `leesh-loop.mjs` 시작 경계에 추가한다.
- 파일, 모듈, 함수 이름은 현재 책임을 그대로 드러내도록 유지하며 fast-start 전용 추상화 계층은 만들지 않는다.
- `start:fast` 이외의 다른 startup alias나 추가 skip 옵션은 이번 계획에 포함하지 않는다.

## Verification

1. **normal start 보존**
   - 기존 `npm start` 경로에서 생성되는 bootstrap 인자를 확인한다.
   - `--skip-external-readiness`가 포함되지 않고 기존 readiness 경로가 유지되는 증거가 있으면 통과한다.

2. **fast start skip 적용**
   - `npm run start:fast`에 대응하는 실제 start 진입 경로를 실행하거나 동등한 CLI integration test를 수행한다.
   - 최종 `operator-bootstrap` 호출에 기존 `--skip-external-readiness`가 전달되고 external readiness가 생략되는 것이 관찰되면 통과한다.

3. **동일한 시작 경로 유지**
   - normal start와 fast start가 동일한 project config와 동일한 `leesh-loop.mjs start` 경로를 사용하고, 차이가 skip override뿐임을 확인한다.
   - 다른 startup 설정이나 runtime identity가 의도치 않게 변경되지 않으면 통과한다.

4. **기존 skip 계약 재사용**
   - 기존 `operator_bootstrap`의 `--skip-external-readiness` 테스트를 함께 실행한다.
   - 새 경로가 별도 readiness 구현이 아니라 기존 skip 계약에 연결되어 있음을 확인한다.

5. **회귀 확인**
   - startup 관련 기존 테스트를 실행한다.
   - normal start, config parsing, bootstrap argument 구성 관련 기존 테스트가 모두 통과하면 회귀 없음으로 판단한다.

## Verification Tools

- **Node test runner**: CLI wiring, bootstrap argument 구성, normal/fast start 차이를 검증한다.
- **기존 `operator_bootstrap` 테스트 fixture**: `--skip-external-readiness`가 실제 external readiness 접근을 생략하는 기존 계약을 검증한다.
- **`package.json` script 실행 경로 확인**: `start`와 `start:fast`가 동일한 startup entry point를 사용하는지 확인한다.
