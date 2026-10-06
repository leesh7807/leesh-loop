# 2026-10-06-project-toml-configuration

## Objective

Leesh Loop의 Project 설정을 Loop 루트의 주석 기반 project.toml로 옮겨 사람이 설정 파일만 읽고 주요 설정의 의미, 기본값, 경로 기준과 사용 방법을 파악하고 수정할 수 있게 한다.

Production start/stop, init 생성 및 readback, E2E production Project loading과 run-scoped runtime이 하나의 TOML Project 계약을 사용해야 한다.

## Intent

현재 operator/project.json은 실제 책임인 Loop 전체 설정과 implementation 위치가 맞지 않고, JSON은 주석이 없어 기본값과 선택 설정을 설명하기 어렵다. 포트 override와 workspace_files도 설정 파일만으로 경로 해석 및 복사 의미가 드러나야 한다.

.env는 Notion 연결 정보와 token 등 환경/credential 경계로 계속 유지한다. TOML은 Project 설정 형식 변경이며 task lifecycle, worker dispatch, workflow contract, readiness, workspace isolation, Publisher 및 E2E reservation/finalization 의미를 바꾸지 않는다.

## Verification Requirements

1. 새 init 결과와 source checkout의 canonical 설정은 Loop 루트 project.toml이며 operator/project.json을 사용하지 않아야 한다. 둘 다 기존 start/stop 경로를 사용할 수 있어야 한다.
2. Production Operator, init 생성/readback, E2E production Project load, run-scoped Project 생성이 동일한 TOML 구조, defaults, validation 및 path-resolution 계약을 사용해야 한다.
3. Project 상대경로는 해당 TOML 파일의 부모 기준이고, 절대경로 및 ~/ 경로 지원은 유지되어야 한다.
4. 생성 TOML만 읽어 UI/Symphony 기본 포트와 override, workspace_files 목적/경로/파일 형식/복사 목적지와 이름/basename 충돌, Git ignored 파일 사용, directory/glob 미지원 및 선택 설정의 defaults를 알 수 있어야 한다.
5. 기본값 선택 설정은 생략하고 주석 예시로 설명한다. 실제 활성화된 override는 runtime에 반영되어야 한다.
6. Port override와 workspace_files의 runtime 의미를 유지한다. 일반 파일은 Git 상태와 무관하게 새 worker workspace 루트로 basename 복사되고 잘못된 source 및 중복 basename은 거부되어야 한다.
7. .env/process environment의 LEESH_LOOP_NOTION_DATABASE_URL 및 NOTION_TOKEN 경계를 유지한다. Init/TOML에 secret 또는 process-only 값이 기록되지 않아야 한다.
8. Lifecycle, Notion publication, dispatch, workflow, readiness, workspace isolation, E2E reservation/finalization 및 per-run isolation 동작을 바꾸지 않아야 한다.
9. malformed TOML, 잘못된 type/value/path는 runtime spawn 전에 명확히 거부되어야 하며 기존보다 약한 validation을 허용하지 않아야 한다.
10. Init의 독립 snapshot, destination collision 거부, partial cleanup, retry 및 target repository 불변성을 유지해야 한다.
11. E2E는 production repository/base/Codex 설정을 계속 읽고 run별 격리 TOML로 실제 Operator start/stop, dynamic port 할당과 port-conflict retry를 실행해야 한다.
12. Project를 직접 생성/소비/설명하는 코드, tests, fixtures, package scripts, CLI/error text 및 README/SYSTEM/E2E 문서가 실제 TOML 계약과 일치해야 한다. Publisher, runtime state, API payload, E2E run/evidence 같은 별도 JSON은 유지한다.

## Definitions

- Project configuration: Loop가 대상 repository, workflow와 local runtime 설정을 정의하는 파일.
- Production Project: source repository 또는 init 생성 일반 Loop의 Project 설정.
- Run-scoped Project: E2E 한 run 전용 임시 Operator/Symphony 설정.
- Project root: init이 만든 <repository-name>-loop의 루트 디렉터리.
- Project-relative path: 해당 project.toml 파일의 디렉터리 기준 상대경로.
- Workspace file: workspace_files에 지정된 일반 파일. source 구조 없이 새 worker workspace 루트에 basename으로 복사한다.
- Defaulted setting: 생략하면 Leesh Loop 자체 기본값으로 동작하는 선택 설정.

## Decisions

1. Root project.toml이 유일한 Project 설정이다. Source production start/stop, init output, E2E config input/output이 TOML을 사용한다. 과거 독립 snapshot 자동 migration은 하지 않는다.
2. TOML parse, settings validation, defaults, path expansion/normalization 및 serialization은 shared Project configuration responsibility에 둔다. Init readback과 E2E production read/run writer도 이를 재사용한다. Generated Loop는 source checkout 없이 동작해야 한다.
3. workflow_path, symphony_workspace_root, state_directory 등 상대경로는 각 project.toml 기준으로 resolve한다. Absolute 및 ~/ 지원을 보존한다. E2E TOML의 path는 각 run config 위치에서 run-owned 자원을 가리킨다.
4. Root project.toml을 discovery surface로 제공한다. Init이 산출물의 정체성을 정하는 필수 값은 활성화하고 선택 기본값은 짧은 설명이 있는 주석 예시로 둔다. Repository/base, workflow, workspace/state, workspace_files, Codex overrides, UI/Symphony ports, browser opening 및 사용자가 운용할 readiness/startup settings를 포함한다. 내부 escape hatch를 확대 공개하지 않는다.
5. workspace_files 기본값은 빈 배열이다. Relative/absolute/~/ source, 일반 파일, Git tracked 여부와 무관한 선택, workspace 루트 basename 복사, duplicate basename 오류와 directory/glob 비지원 의미를 TOML 주석으로 설명한다. 이를 credential 전달의 일반 권장 통로로 바꾸지 않는다.
6. Default ports는 Symphony 4100 및 UI 4310이다. Production은 자동 할당하지 않으며 사용자 override는 validation 단계에서 유효한 port 값으로 확인한다. E2E는 run별 port allocation 및 conflict retry 동작을 보존한다. 오류와 안내는 project.toml을 가리킨다.
7. Init snapshot에는 root project.toml, root WORKFLOW.md, .env.example, runtime 구현 및 start/stop scripts가 포함된다. 생성 직후 production Project reader로 readback한다. Snapshot 독립성, collision, cleanup, retry 및 target 불변성을 보존한다.
8. E2E production identity는 root TOML에서 읽는다. Run-scoped Project도 TOML이며 run별 workflow, workspace, state, base branch, repository, Codex, readiness/browser controls 및 allocated ports를 보유한다. Port retry는 동일 TOML을 갱신한다. Run/evidence JSON은 유지한다.
9. Project config를 직접 생산/소비/설명하는 references만 TOML로 바꾼다. Publisher config, runtime state, API payload, E2E run/evidence JSON은 변경하지 않는다.
10. README, SYSTEM, E2E README, init output, CLI usage/errors, port errors, Project tests/fixtures가 root TOML 책임을 정확히 설명한다.

## Verification

- Shared reader fixture로 required/optional settings, omitted defaults, TOML comments, malformed syntax, wrong type/value, relative/absolute/~/ paths 및 workspace_files validation을 관찰한다.
- Tracked repository search로 Project config 전용 JSON paths/parsers/writers/scripts/text가 제거되고 별도 JSON 책임은 유지되는지 확인한다.
- Source root project.toml을 통한 production start/fast-start/stop 및 explicit config CLI를 확인한다. 잘못된 Project가 child spawn 전에 실패하는지 확인한다.
- 임시 Git target에서 init entry point를 실행해 root TOML 생성/readback, upstream identity, source-independent snapshot, 필요한 주석/예시, .env 경계, target 불변성과 collision/partial cleanup/retry 경로를 확인한다.
- 생성 Loop를 source checkout과 분리해 snapshot-only Project load/start preparation을 확인한다. Non-default ports의 실제 Operator runtime readback과 conflict override, workspace_files의 relative/absolute/~/ 및 ignored source 복사 결과, invalid source/collision rejection을 확인한다.
- Environment 및 root .env에서 Notion URL/token binding을 확인하고 Project/init 산출물에 secret이 없는지 확인한다.
- E2E production Project load → admission → run-scoped TOML readback → Operator start/stop 및 port retry 경로를 확인한다. 가능한 환경에서 production Publisher→Operator→Symphony→worker→finalization까지 실행한다. 외부 제약이 있으면 그 범위 및 남은 불확실성을 밝히고 가장 가까운 실제 entry path를 확인한다.
- 변경 영향이 있는 init, CLI, Operator/readiness, workspace file, E2E config/operator/run suites 및 repository supported checks를 실행하고 diff check 및 문서 일관성을 재확인한다.

## Verification Tools

- Repository-wide tracked-file search: stale Project JSON surface와 의도적으로 유지되는 machine-data JSON 분리 확인.
- Node test suite 및 temporary Git target: reader, init lifecycle, CLI, workspace file, E2E regression 확인.
- Filesystem/runtime readback: generated root project.toml, copied snapshot, allocated ports, runtime identity/state 확인.
- npm start/npm stop 및 npm run e2e: 대표 production entry path 및 run-scoped start/stop orchestration 확인.
- Git status/readback: init이 target을 수정하지 않고 generated runtime이 source checkout에 의존하지 않는지 확인.
