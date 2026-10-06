# 2026-10-06-project-identity-and-repository-navigation

## Objective

`leesh-loop init`으로 생성한 Loop의 Operator UI에서 사용자가 현재 어떤 GitHub Project를 운영하고 있는지 즉시 식별할 수 있게 한다.

Operator 페이지와 브라우저 탭에 대상 Project의 이름을 명확히 표시하고, Project의 GitHub repository로 이동하는 링크가 `init`이 지원하는 upstream 형식과 관계없이 올바른 웹 repository를 열도록 한다.

## Intent

현재 Operator UI는 task와 실행 상태를 중심으로 구성되어 있어, 화면을 열었을 때 어느 Project의 Loop인지 바로 식별하기 어렵다. 여러 Loop를 동시에 열 경우 브라우저 탭만으로도 Project를 구분하기 어렵다.

또한 Project repository navigation이 Git clone에 사용하는 repository URL 표현과 browser에서 열어야 하는 URL 표현을 구분하지 않아, `leesh-loop init`이 허용하는 upstream 형태에 따라 GitHub 링크가 올바르게 만들어지지 않을 수 있다.

이번 작업에서는 Project identity를 별도로 입력하거나 중복 관리하게 만들지 않는다. `init`이 이미 authoritative하게 선택하는 GitHub upstream을 기준으로 Project identity를 일관되게 해석하고, 같은 identity를 Operator의 화면 제목, 브라우저 탭, GitHub navigation에 사용한다.

## Verification Requirements

- `leesh-loop init`으로 생성된 Loop를 실행했을 때 Operator UI에서 현재 대상 GitHub Project를 첫 화면에서 바로 식별할 수 있어야 한다.
- 브라우저 탭 제목에 대상 Project 이름이 포함되어 여러 Loop 페이지를 탭만 보고 구분할 수 있어야 한다.
- Operator UI의 GitHub repository 링크는 대상 Project의 실제 GitHub 웹 repository를 열어야 한다.
- `init`이 현재 지원하는 HTTPS upstream과 SSH upstream 모두에서 동일한 Project 이름과 동일한 GitHub 웹 repository identity가 얻어져야 한다.
- Git clone 및 workspace 생성에 사용하는 기존 `github_repository_url`의 transport와 의미는 변경되지 않아야 한다. SSH upstream을 HTTPS clone URL로 강제로 변경해서는 안 된다.
- Project 이름과 browser repository URL을 사용자가 별도로 설정하거나 `operator/project.json`에서 서로 독립적으로 유지해야 하는 중복 configuration을 새로 요구하지 않아야 한다.
- Project identity는 `init`이 선택한 configured upstream repository에서 나와야 하며 local directory 이름, Loop directory 이름 또는 UI에서의 임의 추론이 authoritative identity가 되어서는 안 된다.
- 잘못된 GitHub upstream은 현재와 마찬가지로 `init`에서 거부되어야 하며, browser navigation 지원을 위해 허용 repository 범위를 넓히거나 validation을 약화하지 않아야 한다.
- Project identity 표시 변경으로 task ordering, polling, Blocked By, Plan publication, State selection, Notion navigation, Symphony navigation 및 기존 Operator lifecycle semantics가 변경되지 않아야 한다.
- wide와 narrow Operator 화면 모두에서 Project identity가 인식 가능하되 task와 publication workflow의 주된 hierarchy를 압도하지 않아야 한다.
- 최종 rendered UI evidence에서 Project 이름, GitHub repository navigation 및 기존 task hierarchy가 함께 실제로 판단 가능해야 한다.

## Definitions

- **Project**: 현재 Loop가 운영하도록 `leesh-loop init`에서 선택된 GitHub repository.
- **Project identity**: configured GitHub upstream으로부터 얻는 repository의 `owner/repository` identity.
- **Project name**: Project identity의 repository 부분. 예를 들어 `owner/leesh-market`의 Project name은 `leesh-market`.
- **Clone URL**: Git clone 및 workspace 생성에 사용하는 기존 `github_repository_url`. HTTPS 또는 SSH transport를 유지한다.
- **Browser repository URL**: Project identity에 대응하는 `https://github.com/<owner>/<repository>` 형태의 GitHub 웹 navigation destination.
- **Project presentation**: Operator UI에서 Project 이름과 repository navigation을 사용자가 인식하는 부분 및 브라우저 탭 제목.
- **Generated Loop**: 대상 repository에서 `leesh-loop init`을 실행하여 sibling `<repo-name>-loop`로 생성되는 독립 Loop.

## Decisions

### Project identity

기존 `github_repository_url`을 Project identity의 authoritative input으로 유지한다.

HTTPS, SCP-style SSH (`git@github.com:owner/repository.git`), URL-style SSH (`ssh://git@github.com/owner/repository.git`)를 각각 별도 UI 규칙으로 처리하지 않고, GitHub repository URL 해석 책임에서 모두 동일한 `owner/repository` identity로 정규화한다.

Project name과 Browser repository URL은 이 identity에서 파생한다.

`github_repository_name`, `github_browser_url`처럼 같은 사실을 별도로 저장해야 하는 generated Project configuration은 추가하지 않는다. 파생 가능한 정보를 여러 곳에 저장하지 않는다.

### Clone URL과 browser URL의 책임 분리

`github_repository_url`은 계속 clone/runtime configuration이다. Browser navigation을 고치기 위해 해당 값을 HTTPS URL로 덮어쓰거나 transport를 바꾸지 않는다.

Operator UI에는 clone URL 자체를 navigation destination으로 노출하지 않고, Project identity로부터 만들어진 Browser repository URL을 사용한다.

GitHub repository URL validation과 identity parsing은 서로 다른 ad-hoc parser로 중복하지 않는다. 현재 repository URL boundary가 GitHub upstream 형식을 검증하는 책임을 가지고 있으므로 해당 책임 안에서 필요한 identity를 함께 얻을 수 있는 구조를 사용한다.

### Operator Project presentation

Operator의 Project-level 영역에서 Project name을 현재 Project를 식별하는 주된 텍스트로 노출한다.

GitHub repository navigation은 이 Project identity와 연결한다. 같은 Project 이름이나 repository link를 task마다 반복하지 않는다.

정확한 typography와 배치는 최종 rendered hierarchy에 따라 정하되, 기존의 typography-first, restrained surface를 유지하고 Project identity를 별도 장식 panel이나 새로운 dashboard summary로 만들지 않는다.

브라우저 document title은 Project name을 앞에 두어 탭을 구분할 수 있게 한다. 기본 형식은 다음 의미를 따른다.

`<Project name> · Loop`

고정 제품명만 표시하거나 전체 clone URL을 tab title에 넣지 않는다.

### `init` 경계

이번 결과는 새로 `leesh-loop init`한 Generated Loop에서 추가 수동 설정 없이 동작해야 한다.

`init`은 기존처럼 configured upstream과 branch를 결정하고 runtime snapshot을 생성한다. Project identity 표시를 위해 사용자가 Project name 또는 browser URL을 별도로 입력하는 prompt를 추가하지 않는다.

Generated Loop의 Project configuration에는 기존 clone/runtime authority를 유지하고, 생성된 runtime이 그 값에서 Project presentation에 필요한 identity를 해석한다.

### Planned units

1. **GitHub Project identity 해석**
   - 지원되는 GitHub upstream 표현을 하나의 `owner/repository` identity로 해석하고 clone transport와 browser destination을 분리한다.
   - 기존 validation 범위와 clone URL 의미는 유지한다.
2. **Operator Project identity presentation**
   - Operator read model이 canonical Project identity를 UI에 제공하고, 화면의 Project name, GitHub navigation, browser title이 모두 같은 identity를 사용하도록 한다.
   - Project-level 표시만 추가하며 task-level navigation과 task data model은 확장하지 않는다.
3. **Generated Loop 계약 검증**
   - 실제 `leesh-loop init` 결과가 HTTPS와 SSH upstream 모두에서 추가 configuration 없이 올바른 Project identity와 repository navigation을 제공함을 검증한다.
   - 기존 init bootstrap, independent runtime snapshot 및 Git clone 계약이 유지됨을 함께 확인한다.

### Protected scope and naming

다음 영역은 이번 변경의 protected scope다.

- configured upstream branch 선택 방식
- `github_repository_url`의 clone/runtime 역할
- GitHub credential 및 clone transport 선택
- workspace 생성 및 Symphony Git target 전달
- Notion task authority와 Publisher semantics
- task polling 및 ordering
- Blocked By
- publication success/failure semantics
- existing Notion/Symphony/task navigation
- `init` destination collision 및 partial cleanup semantics
- target repository working tree 비변경 보장

Project identity 표시를 위해 위 책임을 변경하지 않는다.

파일, module, type 및 주요 함수 이름은 `GitHub repository URL`, `Project identity`, `Operator config/presentation`처럼 실제 현재 책임을 드러내야 한다. 새로운 범용 Project framework나 아직 존재하지 않는 abstraction을 전제로 이름을 만들지 않는다.

KISS, YAGNI, DRY 원칙에 따라 Project identity를 저장·파싱·표시하는 경로를 필요한 범위 이상으로 일반화하지 않는다.

Pull Request를 만들기 전에 이 Plan을 `docs/plans/active/2026-10-06-project-identity-and-repository-navigation.md`에서 `docs/plans/completed/`로 이동한다.

## Verification

### 1. GitHub Project identity

지원되는 각 upstream 표현에 대해 repository identity readback을 확인한다.

대표적으로 같은 repository를 다음과 같이 설정했을 때:

- `https://github.com/example/sample-repository.git`
- `git@github.com:example/sample-repository.git`
- `ssh://git@github.com/example/sample-repository.git`

모두 다음과 동일한 observable identity를 만들어야 한다.

- Project identity: `example/sample-repository`
- Project name: `sample-repository`
- Browser repository URL: `https://github.com/example/sample-repository`

동시에 기존 transport 판정이 각각 HTTPS/SSH로 유지되는지 확인한다.

credential 포함 URL, GitHub가 아닌 host, repository가 아닌 GitHub path 등 현재 invalid input도 계속 거부되는지 확인한다.

### 2. 실제 `leesh-loop init` 결과

HTTPS upstream을 가진 임시 target repository와 SSH upstream을 가진 임시 target repository에 실제 `initLoop` 경로를 실행한다.

각 생성 결과에서:

- `operator/project.json`의 `github_repository_url`이 원래 configured upstream transport를 그대로 보존하는지 확인한다.
- target base branch가 기존 upstream branch를 유지하는지 확인한다.
- 별도의 Project name/browser URL configuration 입력 없이 Generated Loop가 Project identity를 제공할 수 있는 상태인지 확인한다.
- target repository working tree가 변경되지 않았는지 확인한다.

기존 destination collision, partial cleanup, runtime snapshot independence 등 직접 관련된 init 회귀 테스트도 함께 통과시킨다.

### 3. Operator config/read model

Generated Loop의 실제 Operator server를 기준으로 Project-level config readback을 확인한다.

readback의 Project name과 Browser repository URL이 configured clone URL과 동일한 GitHub repository identity를 가리키는지 확인한다.

특히 SSH clone URL이 browser navigation에 그대로 전달되지 않는 것을 확인한다.

UI가 별도의 local basename 또는 hard-coded Project 이름을 사용하지 않는지도 확인한다.

### 4. Browser presentation

Generated Loop의 production Operator UI를 실제 browser에서 연다.

화면을 처음 봤을 때 Project name이 별도 설명을 찾아보지 않고 식별 가능한지 확인한다.

브라우저 탭의 title이 `<Project name> · Loop` 의미를 가지는지 DOM/browser readback으로 확인한다.

GitHub repository navigation을 실행하여 canonical Browser repository URL로 이동하는지 확인한다. SSH clone URL이나 `.git` clone 표현을 browser destination으로 사용하지 않아야 한다.

wide와 narrow viewport에서 Project identity와 GitHub navigation이 모두 발견 가능하면서 기존 task hierarchy 및 publication action보다 과도하게 강해지지 않는지 확인한다.

### 5. 기존 Operator behavior 회귀

기존 Operator UI automated tests와 production build를 실행한다.

대표 UI surface에서 다음 기존 behavior가 유지되는지 확인한다.

- task refresh와 polling
- refresh failure 시 기존 data 유지
- Human Review / active task hierarchy
- Blocked By selection과 표시
- Plan과 State publication
- publication result
- Notion task/Plan navigation
- Symphony navigation

Project presentation 추가를 이유로 이들 behavior의 test expectation이나 의미를 약화하지 않는다.

### 6. Rendered UI evidence

최종 HEAD의 Generated Loop 또는 동일한 production Operator surface를 wide와 narrow viewport에서 렌더링하여 `docs/ui-evidence/`에 current screenshots를 남긴다.

evidence에는 최소한 다음을 한 화면에서 판단할 수 있어야 한다.

- Project name
- GitHub repository navigation
- 주요 task hierarchy
- publication surface와의 상대적 visual weight

최종 UI-only review는 이 committed screenshots를 primary evidence로 사용한다.

rendering에 영향을 주는 변경이 review 과정에서 추가되면 screenshots도 동일 HEAD의 결과로 다시 생성한다.

실제 browser rendering을 검증하지 못했다면 automated component/source 검증만으로 UI 관련 Verification Requirement를 충족한 것으로 간주하지 않고 남은 불확실성을 명시한다.

## Verification Tools

- `node --test operator/app/test/init.test.mjs`
  - HTTPS/SSH configured upstream, Generated Loop configuration, target repository 비변경 및 기존 init 회귀를 검증한다.
- GitHub repository URL 관련 focused unit tests
  - supported upstream 형식의 validation, Project identity, Project name 및 Browser repository URL 해석을 검증한다.
- Operator server/config focused tests
  - runtime config readback이 clone URL과 동일한 canonical Project identity를 UI에 제공하는지 검증한다.
- Operator UI automated tests
  - Project name, GitHub navigation 및 document title wiring과 기존 UI behavior 회귀를 검증한다.
- Production UI build
  - 실제 Generated Loop에 포함되는 UI artifact가 정상적으로 생성되는지 확인한다.
- 실제 `leesh-loop init` 생성 결과 readback
  - 생성된 `operator/project.json` 및 runtime에서 clone transport 보존과 추가 configuration 불필요성을 확인한다.
- Browser/DOM readback
  - Project name, `<title>`, 실제 GitHub link destination을 확인한다.
- Wide/narrow browser screenshots와 `docs/ui-evidence/`
  - 실제 Project identity hierarchy와 기존 task/publication surface와의 시각적 관계를 검증한다.
- Independent UI-only review
  - committed rendered evidence를 기준으로 Project 식별 가능성, hierarchy, scanability 및 responsive 결과를 평가한다.
- `npm test`
  - repository 기본 test entry point에서 관련 Operator/init 회귀를 확인한다.
- `git diff --check`
  - 최종 변경의 whitespace 오류를 확인한다.
- repository diff/readback
  - clone/runtime, Publisher, Notion, Symphony 및 task lifecycle의 protected scope를 불필요하게 변경하지 않았는지 확인한다.
