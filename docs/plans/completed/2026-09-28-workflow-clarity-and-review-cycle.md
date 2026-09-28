# 2026-09-28-workflow-clarity-and-review-cycle

## Objective

`WORKFLOW.md`의 작업 기록과 review 흐름을 정리해, worker가 이전 실행의 문맥을 명확하게 이어받고 실제 작업을 안정적으로 계속할 수 있게 한다.

Workpad는 실제 작업의 진행, 판단, 검증, 현재 상태와 남은 일을 간결하고 명확하게 남기는 실행 기록이어야 한다. Workflow protocol이나 내부 구현 용어가 기록의 중심이 되거나, protocol 설명과 실제 작업 내용이 뒤섞여 실제 의미를 파악하기 어려워서는 안 된다.

정상적인 Human Review 진입 시점에는 동일한 exact HEAD에 대한 code review와 structure review가 모두 완료되고 유효한 finding이 남아 있지 않아야 한다.

Worker가 후속 작업을 발견한 경우에는 `docs/PLAN.md`에 맞는 Plan을 작성하고 현재 작업 문맥을 함께 제공하는 independent Plan review를 거쳐 발행할 수 있어야 한다. 후속 task publication과 현재 task의 `Blocked By` 연결도 필요한 기록과 정리를 마친 뒤 안전하게 완료될 수 있어야 한다.

## Intent

Workpad는 retry, continuation, Human Review 복귀, Rework 등 이후 실행이 이전 작업의 상태를 복원하고 그대로 이어가기 위한 live execution context다.

현재 문제는 lifecycle marker의 존재 자체가 아니다. 일반 작업 내용, review 결과, lifecycle marker, exact identity와 복구용 metadata가 같은 서술 층에 이어지고, `Human Review Entered`, `Review Input`, `Rework Reset Complete`, `delivered_head`, `comment_baseline` 같은 protocol·field 중심 표현이 실제 작업 설명까지 지배한다. 이 때문에 무엇을 했고 무엇이 남았는지보다 workflow가 어떻게 동작하는지를 설명하는 문장이 더 길어지고, 다음 worker가 실제 작업 문맥을 복원하는 비용이 커진다.

따라서 Workpad는 실제 작업의 의미를 우선하고 필요한 protocol 정보는 정확성을 유지하면서 작업 설명과 구분한다. 기술적인 표현, 문맥 없는 상태 나열, 반복, 내부 처리 과정의 장황한 설명을 줄이되, 이를 해결하기 위해 세부 template이나 새로운 formatting protocol을 추가하지 않는다.

Delivery review는 동일한 exact HEAD에 대한 code review와 structure review를 하나의 cycle로 본다. Review Result 자체가 `PASS`여야 하는 것은 아니며, 각 finding을 기존 evidence-based validity 기준으로 disposition한 뒤 유효한 finding이 남아 있지 않으면 해당 review는 완료된 것으로 본다. 유효한 finding 수정으로 HEAD가 바뀌면 새 HEAD에서 cycle을 다시 시작한다.

후속 Plan은 아직 Accepted Plan이 아니므로 candidate Plan 자체를 사용자 계약의 근거로 삼지 않는다. 현재 Accepted Plan과 실제 작업에서 확인된 관련 문맥을 함께 전달해 candidate Plan의 목표, 의도, 계약과 검증 요구 자체를 검토한다.

Plan review는 합리적인 구현에서 material하게 다른 결과나 보장으로 이어질 계약 누락, 목표와 의도의 왜곡, 필요 이상으로 강한 계약·결정·복잡성, 실제 실패를 성공으로 판단하게 만드는 verification 문제를 찾는 데 초점을 둔다. 반대로 기존 코드, repository convention과 이미 정해진 계약으로 합리적으로 수렴할 수 있는 선택이나 단순 미결정은 구현에 맡긴다. KISS, YAGNI, DRY도 이 관점에서 적용한다.

Reviewer에게는 이 판단에 필요한 현재 작업 문맥만 전달한다. 현재 Accepted Plan의 관련 목표나 경계, 실제로 확인된 결과, 현재 작업과 후속 작업의 경계, 존재하는 concrete evidence와 현재 작업 중 사용자가 명시해 후속 작업의 근거가 된 요구를 짧고 일관된 형태로 제공한다. PR이 있으면 evidence로 활용하지만 PR 존재를 review의 전제조건으로 만들지 않는다.

이번 변경은 새로운 execution capability나 integration을 만드는 작업이 아니라 `WORKFLOW.md`의 규칙과 review request를 정리하는 작업이다. Plan reviewer의 실제 판단 품질도 확률적인 agent behavior이므로 실제 Candidate Plan review·publication이나 production E2E를 성공 조건으로 두지 않는다. 필요한 review 관점과 문맥이 요청에 명시되어 있고 기존 workflow와 논리적으로 일관되는지를 정적으로 확인하는 것으로 충분하다.

Plan review를 위해 기존 independent review의 Job 처리, finding disposition과 blocker handoff를 새로 복제하지 않는다. 같은 규칙을 여러 위치에서 반복해 `WORKFLOW.md`를 더 길고 난해하게 만들지 않는다.

후속 task를 현재 task의 blocker로 연결하는 mutation은 Plan review와 publication이 끝나고 현재 worker가 필요한 기록과 정리를 마친 뒤 수행한다. Relation 연결이 성공한 경우 이 mutation은 현재 실행의 마지막 정상 lifecycle mutation이 된다.

## Verification Requirements

- Workpad는 다음 실행이 완료된 결과, 현재 상태, 판단, blocker와 남은 일을 빠르게 복원할 수 있는 명확한 실행 기록이어야 한다.
- 실제 작업 내용과 lifecycle 복구용 protocol 정보는 구분되어야 하며, protocol 설명이나 내부 용어가 실제 작업 설명보다 비대해져서는 안 된다.
- 기존 canonical lifecycle marker와 metadata의 의미는 유지해야 하며, 이를 위해 새로운 세부 template이나 고정 formatting protocol을 추가해서는 안 된다.
- 정상적인 `reason: review` Human Review는 동일한 exact HEAD에서 code review와 structure review가 모두 완료되고 기존 validity 기준에 따라 유효한 finding이 남아 있지 않은 경우에만 준비되어야 한다.
- 유효한 finding 수정으로 HEAD가 변경되면 이전 HEAD의 review 결과를 새 HEAD의 완료 근거로 재사용해서는 안 된다.
- Review를 완료하지 못하면 기존 blocker handoff를 사용해야 한다.
- Worker가 후속 Plan을 발행할 때 그 Plan은 `docs/PLAN.md`를 따라야 하며 publication 전에 independent Plan review를 거쳐야 한다.
- Plan review request에는 complete Candidate Plan과 함께 현재 Accepted Plan의 관련 목표 또는 경계, 실제로 확인된 결과, 현재 작업과 후속 작업의 경계, 존재하는 concrete evidence, 현재 작업 중 사용자가 명시해 후속 작업의 근거가 된 요구를 전달할 수 있어야 한다.
- PR이 존재하면 evidence로 사용할 수 있어야 하며, PR이 없어도 정상적으로 Plan review를 요청할 수 있어야 한다.
- Plan review request에는 Candidate Plan 자체를 확정된 계약으로 전제하지 않고 그 `Objective`, `Intent`, `Verification Requirements` 자체도 review 대상이라는 점과, Intent에서 정한 Plan review 관점이 포함되어 있어야 한다.
- Plan review request에는 material한 계약 누락·왜곡·과잉 규정·verification gap을 검토하되 단순 미결정이나 합리적인 구현 선택을 finding으로 확대하지 않고, 중심 실행 경로와 observable evidence 및 KISS, YAGNI, DRY를 고려하도록 하는 관점이 명시되어 있어야 한다.
- Plan review finding은 자동 수정 명령으로 취급하지 않고 기존 evidence-based disposition 원칙을 따라야 하며, 유효한 수정으로 Candidate Plan이 material하게 바뀌면 다시 review해야 한다.
- Review를 완료한 Candidate Plan만 `notion_task_publish_plan`에 전달한다.
- 후속 task publication과 `Blocked By` 연결에서는 relation mutation 전에 필요한 Workpad 기록과 현재 실행의 정리가 완료되어야 한다. Relation 연결이 성공한 경우 `notion_task_add_blocked_by`는 현재 실행의 마지막 정상 lifecycle mutation이어야 하며, publication 성공 후 relation 연결 실패를 완결된 성공으로 표현해서는 안 되고 미완료 상태 기록과 기존 blocker handoff가 가능해야 한다.
- Plan review 추가는 기존 independent review의 Job 처리, failure handling, finding disposition 또는 lifecycle 의미를 불필요하게 복제하거나 변경해서는 안 된다.
- 변경된 `WORKFLOW.md`는 기존 workflow와 의미가 크게 어긋나거나, 같은 규칙의 중복과 과도한 protocol 설명 때문에 기존보다 길고 해석하기 어려워져서는 안 된다.
- 이번 변경의 성공 여부는 workflow text와 review request construction을 정적으로 확인해 필요한 context와 review 관점, review/publication 순서, 기존 workflow와의 비충돌·비중복을 입증할 수 있으면 충분하다. 실제 Candidate Plan review/publication이나 production E2E는 필수 검증이 아니다.
- 이번 변경은 별도 execution journal, durable review state, 새로운 lifecycle state 또는 Plan-review 전용 orchestration을 추가해서는 안 된다.

## Definitions

**작업 내용**

현재 Accepted Plan을 수행하며 실제로 조사, 결정, 변경, 검증하거나 남긴 결과.

**Protocol 정보**

Human Review cycle, Review Input boundary, exact PR/HEAD, comment baseline, merge identity 등 workflow를 복구하거나 정확히 이어가기 위해 필요한 canonical marker와 metadata.

**Delivery review cycle**

현재 delivery HEAD에 대해 code review와 structure review를 수행하고, 유효한 finding 수정으로 HEAD가 바뀌면 새 HEAD에서 다시 시작하는 검토 반복.

**Review-complete HEAD**

동일한 exact HEAD에 대해 code review와 structure review가 모두 완료되고 finding disposition 후 유효한 finding이 남아 있지 않은 HEAD.

**Candidate Plan**

후속 작업으로 발행하기 위해 작성했지만 아직 canonical task의 Accepted Plan으로 발행되지 않은 Plan.

**Current work context**

Candidate Plan의 목표, 의도와 검증 요구를 판단하기 위해 review request에 함께 전달하는 현재 작업의 관련 문맥. 현재 작업 중 사용자가 명시해 후속 작업의 근거가 된 요구도 여기에 포함될 수 있다.

## Decisions

1. Workpad는 무엇을 했는지, 무엇이 바뀌었는지, 무엇이 검증되었는지, 무엇이 남았는지가 먼저 드러나도록 작성한다.

   짧고 구체적으로 쓰고, 같은 의미에는 같은 용어를 사용하며, protocol이나 field 이름은 정확성이 필요할 때만 사용한다. 이미 기록한 사실을 반복하거나 실행 과정을 command log처럼 남기지 않는다.

2. 작업 내용과 Protocol 정보를 같은 서술 층에 섞지 않는다.

   기존 lifecycle이 요구하는 canonical marker와 metadata는 유지하되 일반 작업 설명을 대신하게 하지 않는다. 주요 문맥 전환은 명확하게 구분하되 특정 separator나 heading을 새 protocol로 정하지 않는다.

3. Delivery review는 `code review → structure review` 순서로 수행한다.

   각 finding은 기존 validity 기준으로 검증한다. 무효 finding은 이유와 함께 reject할 수 있고, 유효한 finding만 수정한다. 유효한 수정으로 HEAD가 바뀌면 새 HEAD에서 code review부터 다시 시작한다.

4. `reason: review`의 `delivered_head`는 Review-complete HEAD여야 한다.

   Review Job 또는 submission을 완료하지 못하면 기존 blocker handoff를 사용한다.

5. Worker가 후속 작업을 발행할 때는 `docs/PLAN.md`에 따라 Candidate Plan을 작성하고 publication 전에 `chatgpt-shot` Plan review를 수행한다.

6. Plan review에는 complete Candidate Plan과 다음 Current work context를 함께 전달한다.

   ```text
   Current work context:

   Current objective:
   <현재 Accepted Plan에서 직접 관련된 목표, 의도 또는 경계>

   Observed result:
   <후속 작업의 필요성을 발생시킨 실제 결과>

   Follow-up boundary:
   <현재 작업에서 처리한 범위와 후속 작업으로 남기는 범위>

   User requirement:
   <현재 작업 중 사용자가 명시해 후속 작업의 근거가 된 요구; 없으면 none>

   Evidence:
   <PR URL, exact HEAD, artifact 또는 concrete observation; 없으면 none>
   ```

   Candidate Plan에서 새로 만든 주장, 전체 Workpad 또는 실행 transcript를 context로 만들지 않는다. 다만 현재 작업 중 사용자가 명시해 후속 작업의 근거가 된 요구는 authoritative input으로 Current work context에 포함할 수 있다.

7. PR이 있으면 evidence로 사용하되 PR이 없는 경우 review를 지연하거나 임시 PR을 만들지 않는다.

8. Plan review request에는 Candidate Plan 자체가 아직 Accepted Plan이 아니며 그 `Objective`, `Intent`, `Verification Requirements` 자체도 review 대상이라는 점과, Intent에서 정한 review 관점이 포함되어야 한다.

9. Plan review는 기존 independent review의 submission, polling, terminal result, failure handling과 finding disposition을 재사용한다. Plan review만을 위한 별도 Job lifecycle이나 recovery 규칙을 만들지 않는다.

10. Plan review finding은 자동 수정 명령이 아니다.

    Worker가 Current work context, 현재 Accepted Plan, repository contract와 `docs/PLAN.md`에 대해 유효성을 판단하고 유효한 finding만 반영한다. Material한 수정이 있으면 변경된 Candidate Plan을 다시 review한다.

11. Review를 완료한 Candidate Plan만 `notion_task_publish_plan`에 전달한다.

12. 후속 task의 canonical identity를 확보한 뒤 필요한 Workpad 기록과 현재 실행의 정리를 먼저 마치고 `notion_task_add_blocked_by`를 수행한다.

    Relation 연결이 성공한 경우 `notion_task_add_blocked_by`는 현재 실행의 마지막 정상 lifecycle mutation이어야 한다.

    Publication은 성공했지만 relation mutation이 실패하면 생성된 task와 미완료 relation 상태를 기록하고 기존 blocker handoff를 사용한다.

13. 기존 `Blocked By`의 dispatch 의미, additive relation semantics, append 기반 Workpad semantics와 State/workspace/Repository Plan/Workpad의 기존 authority는 유지한다.

14. 새 규칙은 기존 workflow의 관련 계약을 재사용하고, 동일한 규칙을 여러 위치에서 다시 정의하지 않는다. Plan review에 필요한 차이도 대상과 request 내용에 한정한다.

15. **Protected scope**

    다음 의미는 변경하지 않는다.

    - Notion Workpad primitive와 provider binding
    - task State와 `Blocked By` semantics
    - Human Review / Review Input / Rework / Merging lifecycle
    - independent review Job contract
    - 기존 code/structure review finding validity와 범위
    - Publisher publication ownership
    - Repository Plan과 `docs/PLAN.md`의 역할

16. **Naming**

    새 이름이 필요하면 현재 책임을 직접 드러내게 한다. Journal, logging framework, generic review framework, Plan-review state store 또는 follow-up workflow engine 같은 새 추상화를 만들지 않는다.

## Verification

1. 변경된 `WORKFLOW.md`를 전체 흐름으로 읽어 Workpad에서 실제 작업의 의미가 protocol 설명보다 먼저 이해되고, 기존 lifecycle marker와 metadata의 의미가 유지되는지 확인한다.

2. Workpad 규칙이 command log나 전체 transcript를 요구하지 않고, 작업 내용과 Protocol 정보를 구분하면서도 새로운 고정 formatting protocol을 추가하지 않는지 확인한다.

3. Delivery review 규칙을 확인해 동일 exact HEAD의 code review와 structure review가 모두 완료되고 모든 finding disposition 후 유효한 finding이 남아 있지 않아야 Human Review로 진행하는지 확인한다.

4. 무효 finding은 raw `PASS`를 얻기 위한 재-review 없이 disposition할 수 있고, 유효한 finding 수정으로 HEAD가 바뀐 경우에만 새 HEAD에서 cycle을 다시 시작하는지 확인한다.

5. Plan review request에 complete Candidate Plan과 `Current objective`, `Observed result`, `Follow-up boundary`, 필요한 경우 `User requirement`, `Evidence`를 전달하도록 규정되어 있는지 확인한다.

6. PR이 있는 경우와 없는 경우 모두 request를 정상적으로 구성할 수 있는지 확인한다.

7. Plan review request text에 Candidate Plan 자체를 확정 계약으로 보지 않는다는 점과 Intent에서 정한 review 관점이 포함되어 있는지 확인한다.

   Reviewer가 실제로 올바른 판단을 내리는지는 검증하지 않는다.

8. Plan finding disposition, material change 후 re-review, review 완료 전 publication 금지의 논리적 흐름이 닫혀 있는지 확인한다.

9. 기존 independent review와 비교해 Job 처리, failure handling, finding disposition을 중복 정의하거나 의미를 변경하지 않았는지 확인한다.

10. 후속 작업 흐름을 정적으로 따라 review → publication → canonical identity 확보 → Workpad 정리 → `Blocked By` 순서가 명확하고, relation 연결 성공 시에는 이를 마지막 정상 lifecycle mutation으로 종료하며 실패 시에는 미완료 relation 상태 기록과 기존 blocker handoff가 가능함을 확인한다.

11. 변경 전후 `WORKFLOW.md`를 비교해 기존 lifecycle과 authority가 유지되고, 같은 규칙이나 설명의 불필요한 반복 때문에 문서가 더 길고 난해해지지 않았는지 확인한다.

12. 관련 기존 regression을 실행하고 `git diff --check`로 최종 diff를 확인한다.

실제 Candidate Plan review/publication, 실제 후속 task 생성 또는 production E2E는 이번 변경의 필수 검증이 아니다.

## Verification Tools

- `WORKFLOW.md` — Workpad 경계, delivery review, Plan review request, 후속 작업 순서와 전체 문서의 중복·가독성 확인.
- `docs/PLAN.md` — Candidate Plan과 Plan review에 적용되는 planning contract 확인.
- `docs/WORKFLOW_TEMPLATE.md` — reusable policy와 repository workflow 사이의 불필요한 divergence 확인.
- 관련 workflow/Symphony/Notion tests — 기존 lifecycle, review failure, publication과 `Blocked By` semantics regression 확인.
- 기존 `chatgpt-shot` review 관련 tests 또는 request-construction tests — 기존 Job contract 재사용과 Plan review request 구성 확인.
- source diff — 중복 규칙, authority 충돌, 불필요한 abstraction 확인.
- `git diff --check` — 최종 diff consistency 확인.
