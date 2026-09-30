# 2026-09-30-repository-loop-init

## Objective

대상 Git repository에서 `leesh-loop init`을 실행해, 현재 Leesh Loop를 바탕으로 하지만 생성 이후 원본 checkout과 독립적으로 동작하는 해당 repository 전용 Loop를 만든다. 생성 결과는 별도 directory에서 실행할 수 있고, 대상 repository 작업을 Notion → Symphony → worker 경로와 workflow로 운영한다.

## Intent

대상 repository를 Leesh Loop 구조로 바꾸거나 원본 Leesh Loop에 계속 연결하지 않고, `init` 시점의 Leesh Loop에서 독립 실행본을 만든다. 기본 destination은 `../<repository-name>-loop`이며 기본 workflow도 이 Loop가 소유한다. 사용자는 기존 `workflow_path` 계약을 사용해 workflow 위치를 바꿀 수 있다. 이번 범위의 CLI 제공은 `npm link`면 충분하며 정식 배포 체계는 포함하지 않는다.

## Verification Requirements

- 대상 Git repository root에서 실제 `leesh-loop init` 실행 시 sibling `../<repository-name>-loop`가 생성되고 Target repository에는 runtime/workflow 파일이 추가되지 않는다. 기존 destination은 종류와 무관하게 실패하며 내용이 바뀌지 않는다. 생성 후 임의 단계 실패 시 init 전 없던 destination은 제거되어 재시도가 가능하다.
- 생성된 Loop는 원본 checkout의 경로, 이후 수정/삭제, `node_modules`, linked package, dependency directory/state를 runtime dependency로 사용하지 않는다. Runtime snapshot은 단일 manifest 또는 동등 authority로 실행 필수 파일만 포함하고, source 문서·계획·E2E evidence·개발 파일 전체 복사는 하지 않는다.
- Generated Loop 내부가 Node/Symphony package dependency authority와 자동 preparation을 완결한다. 사용자가 별도로 `npm install`, `npm ci`, `mix deps.get`을 실행하지 않고 `npm start`를 정상 다음 단계로 사용한다. Node/npm/mise 등 host toolchain 자체는 번들하지 않으며 실제 prerequisite가 드러나야 한다.
- Project Git target은 init 대상 현재 branch의 configured upstream remote URL 및 remote branch에서 가져온다. upstream이 없으면 임의의 remote/branch로 대체하지 않고 명확히 실패한다. Generated Project는 `gpt-6-luna` 및 `xhigh`, Loop-local workflow, instance-local Symphony workspace/runtime state를 설정한다.
- 기본 workflow는 `docs/WORKFLOW_TEMPLATE.md`에서 생성하고 Loop directory가 소유한다. reusable Plan-based worker policy, configured GitHub base에서 시작하는 일반 branch/PR delivery, `chatgpt-shot submit/jobs` independent review flow를 포함한다. target 고유 build/test/setup은 repository evidence로 찾으며 추측하지 않는다. Leesh Loop root `WORKFLOW.md`에만 유효한 source path/bootstrap/build/test/운영 가정을 다른 repository 계약으로 가져오지 않는다. `workflow_path` 수정 가능성은 유지한다.
- `LEESH_LOOP_NOTION_DATABASE_URL`은 기존 Operator와 동일하게 process environment 또는 Generated Loop root `.env`에서 읽는다. init은 database를 선택/생성하거나 secret을 복사하지 않는다. 미설정이어도 생성은 성공하되 미연결 상태와 `npm start` 전 필요한 설정을 안내한다.
- Generated Loop의 `npm start` / `npm stop`은 자체 snapshot과 기존 production lifecycle을 사용한다. runtime/package/config 경로, host prerequisite, 생성 Project 값, Notion binding 상태 및 다음 실행 명령을 완료 출력에서 정확히 읽을 수 있다. 실패를 production startup 성공으로 가장하지 않는다.
- init 성공 출력에는 output directory, upstream remote URL/branch, workflow path, model/reasoning, Notion 상태 및 설정 위치, host prerequisites, 수정 가능한 Project 설정, `cd`, environment/credential setup, `npm start`가 표시된다. 별도의 package installation 명령을 정상 단계로 요구하지 않는다.
- Generated Loop runtime state와 Symphony workspace는 instance-local이다. Target repository에는 init 기본 동작으로 변경이 없다. source checkout의 의존성을 끊은 상태에서도 생성 filesystem 및 dependency preparation 경로가 자체 authority에서 resolve된다.
- 현재 sandbox에서는 Generated Loop의 실제 production `npm start`가 Symphony host/runtime까지 실행됨을 검증할 수 없으므로 이를 주장하지 않는다. 실제 CLI init, 결과 및 preparation 경로까지 검증하고 사용자 host에서 `cd /tmp/<repository-name>-loop && npm start`를 실행할 수 있도록 명확히 handoff한다.

## Definitions

- **Target repository**: `leesh-loop init`을 실행하는, 생성된 Loop가 관리할 Git repository.
- **Loop instance**: Target repository 하나를 운영하기 위해 생성된 독립 실행본. 기본 위치는 `../<repository-name>-loop`.
- **Source checkout**: 생성 시점의 Leesh Loop checkout. init 후 runtime authority가 아니다.
- **Runtime snapshot**: Source checkout에서 실행에 필요한 tracked assets만 선택해 materialize한 결과.
- **Generated workflow**: reusable workflow template에서 Target repository용으로 만든 workflow.
- **Host toolchain**: Loop 외부가 제공하는 Node, npm, mise 및 Leesh Loop의 기존 host 실행 도구.

## Decisions

### CLI, destination, Git target

- Target repository root에서 `leesh-loop init`을 제공하고, 기본으로 repository parent의 `<repository-name>-loop`에 만든다.
- destination이 이미 존재하면 변경 없이 실패한다. merge/overwrite/repair/reuse를 하지 않는다.
- Project URL/branch는 현재 local branch의 configured Git upstream remote URL/branch만 사용한다. upstream 부재 시 명확하게 실패한다.
- Existing GitHub Project target과 호환되는 upstream HTTPS/SSH URL을 그대로 기록한다. inline URL credentials는 복사하지 않고 명확하게 거부한다.
- Source checkout path/dependency를 참조하지 않도록 init 시점의 독립 Runtime snapshot을 만든다. 복사 대상은 하나의 explicit manifest authority로 관리하고 범용 packaging system은 만들지 않는다.
- 생성 도중 실패하면 새로 만든 destination 전체를 정리한다. 실행 전 있던 path/user data는 정리하지 않는다.

### Runtime, Project, binding

- Project contract는 기존 Operator를 사용한다: upstream URL/branch, Loop-owned workflow, `gpt-6-luna`, `xhigh`, instance-local Symphony workspace/runtime state.
- Generated package는 `npm start`와 `npm stop`만 제공하고 기존 production `leesh-loop.mjs` lifecycle로 이어진다. dependency versions는 기존 manifest/lockfile authority를 보존한다. preparation은 init 또는 start 시 Generated Loop 내부에서 수행한다.
- 기존 `LEESH_LOOP_NOTION_DATABASE_URL` process environment/root `.env` 계약을 유지한다. `init`은 DB나 credential을 만들거나 복사하지 않는다. `.env.example`에는 key와 설정 안내만 둔다.
- Node/npm/mise와 그 아래 Erlang/Elixir host toolchain을 번들하지 않는다. 기존 runtime/tool configuration을 snapshot에 보존하여 실제 prerequisite를 확인할 수 있게 한다.

### Workflow ownership

- `docs/WORKFLOW_TEMPLATE.md`를 다른 repository용 reusable policy로 사용하고, root `WORKFLOW.md`는 이 repository의 concrete workflow로 둔다.
- Generated workflow를 concrete root workflow의 치환 복사로 만들지 않는다. repository-specific path/bootstrap/build/test/운영 규칙은 제외하며 common Plan policy, generic configured-base GitHub delivery, `chatgpt-shot` independent review flow를 유지한다.
- 기본 workflow는 Loop directory 소유다. 사용자가 이동/복사하고 Project의 기존 `workflow_path`를 바꿀 수 있으며 별도 relocation option은 요구하지 않는다.

### Completion output and boundaries

- init 완료 출력은 Generated configuration/readback에서 만든 값과 binding 상태를 보여주고, setup 항목 및 `npm start`를 안내한다.
- 정식 배포/installer, bundled runtime, auto-upgrade, 기존 instance 갱신, Notion database provisioning, central multi-repository manager는 이번 범위가 아니다.
- 기존 Publisher → Operator → Symphony → worker production path/lifecycle, Git target, readiness, workspace isolation, tracker credential isolation, `workflow_path` 및 Notion binding authority를 변경하지 않는다. `operator/symphony/`를 수정하지 않는다.

## Verification

- Source checkout을 `npm link`로 노출하고, 실제 upstream tracking이 설정된 별도 Target repository root에서 `leesh-loop init`을 실행한다. Git readback, 생성 Project/workflow/package/config, output, Target 변경 여부 및 instance-local 경로를 확인한다.
- Upstream 없는 repository, 기존 destination, Project/workflow/runtime materialization의 post-create 실패를 실제 CLI 경로로 재현한다. 목적지 부재/기존 내용 보존 및 같은 target 재시도를 확인한다.
- Runtime materialization manifest와 결과 파일을 대조해 production 실행 파일만 포함되는지, dependency authority가 snapshot 내부 manifest/lockfile을 쓰는지, Source `node_modules`/linked path를 참조하지 않는지 확인한다. dependency preparation 경로는 source dependencies를 사용할 수 없는 통제 환경에서 확인한다.
- Generated workflow 전문을 reusable template 및 concrete workflow와 대조해 공통 정책과 chatgpt-shot review가 유지되고 root repository 고유 가정이 제외되었는지 확인한다.
- Notion URL 없는 init에서 생성 성공, `.env.example`, 완료 출력 및 미설정 표시를 확인한다. 기존 Operator config loader가 Generated root `.env`/process environment의 값을 읽는 것을 확인한다.
- Host prerequisite는 Generated package manifest/lockfile 및 Symphony `mise.toml`, `mix.exs`, `mix.lock`과 일치시킨다. Production `npm start`는 sandbox 경계를 넘어야 하므로 여기서는 성공을 주장하지 않고, 사용자 host의 `npm start` 검증을 handoff한다.

## Verification Tools

- `npm link`, `leesh-loop init`, Git CLI, filesystem readback: 실제 생성 flow, upstream, 충돌, cleanup, target 보존 확인.
- Node/npm package manifests 및 lockfile: snapshot dependency authority와 preparation 확인.
- Generated Project, `WORKFLOW.md`, package surface, `.env.example`: Project defaults, workflow contract, start/stop, Notion binding 확인.
- 기존 Operator configuration loader 및 Symphony tool metadata: Generated root 설정 readback과 host prerequisites 확인.
- Repository test runner: deterministic discovery/upstream/generation/cleanup/dependency/output 책임의 회귀 검증. 실제 CLI 흐름의 대체물이 아니다.
