# 2026-09-17-async-independent-review-job

## Objective

Leesh Loop의 independent `chatgpt-shot` review gate를 현재의 asynchronous durable Job 계약에 맞춘다.

Worker는 review request를 제출해 Job ID를 얻고, 해당 Job을 주기적으로 조회해 terminal State에 도달한 뒤 기존 review Result 처리 흐름을 계속한다.

이번 계획은 independent review 실행 계약만 변경한다. 기존 finding 검증, fix/re-review, Workpad 기록, `Human Review` handoff, repository lifecycle과 submission failure의 기본 blocker 정책은 유지한다.

## Definitions

**Review Job**

하나의 independent `chatgpt-shot` review request와 그 durable lifecycle.

**Review target**

독립 리뷰가 검증해야 하는 PR과 정확한 HEAD를 포함한 요청 대상.

**Job ID**

성공한 `chatgpt-shot submit "<prompt>"`이 stdout으로 반환하는 UUID.

이 ID를 이후 Job 조회에 사용한다.

**Job State**

Review Job의 현재 durable State.

```text
pending
in_progress
completed
failed
```

`pending`과 `in_progress`는 non-terminal State다.

`completed`와 `failed`는 terminal State다.

**Review Result**

`completed` Review Job의 `result`.

기존 independent review gate가 finding 검증과 PASS 판정에 사용하는 결과다.

## Intent

현재 Leesh Loop workflow는 `chatgpt-shot submit`이 review 완료까지 기다리고 stdout으로 Result를 반환하는 동기 계약을 전제로 한다.

현재 `chatgpt-shot` 계약에서는 `submit`이 remote acceptance 이후 Job ID만 반환하고, Result와 Error는 이후 Job 조회를 통해 읽는다.

Independent review gate는 이 계약 차이만 흡수해야 한다.

Worker가 별도의 durable Job lifecycle이나 retry state machine을 만들 필요는 없다. Job이 아직 실행 중이면 기다리고, 완료되면 Result를 사용하며, 실제 Job이 `failed`일 때만 기존 blocker 경로로 들어간다.

Review target 자체를 잘못 제출한 경우는 Job failure와 구분한다. 완료된 잘못된 request를 복구하려 하지 않고 올바른 target으로 새로운 Review Job을 제출한다.

## Decisions

1. Worker-facing `chatgpt-shot` interface는 independent review를 위해 다음 두 명령만 지원한다.

   ```text
   chatgpt-shot submit "<prompt>"
   chatgpt-shot jobs <job-id>
   ```

   현재 `WORKFLOW.md`의 `Use only `chatgpt-shot submit "<prompt>"`.` 문장은 두 명령을 지원하도록 교체한다. 그 외 Service start/stop/authentication/repair 금지 계약은 유지한다.

2. `chatgpt-shot submit "<prompt>"`의 성공 stdout은 Review Result가 아니라 Job ID로 해석한다.

   Independent review section은 submit stdout을 Review Job ID로 정의하고 완료 Result는 이후 Job 조회에서 읽도록 수정한다. 기존 review prompt 본문과 `[Additional review criteria]` 계약은 변경하지 않는다.

3. Job ID를 얻은 뒤 worker는 `chatgpt-shot jobs <job-id>`를 30초 간격으로 조회한다.

   ```text
   After submission succeeds, poll `chatgpt-shot jobs <job-id>` every 30 seconds until the Review Job reaches a terminal State.

   - `pending`: wait 30 seconds and poll the same Job again.
   - `in_progress`: wait 30 seconds and poll the same Job again.
   - `completed`: use the Job's `result` as the independent review Result.
   - `failed`: use the existing independent-review blocker handoff described below.

   Do not submit another Review Job for the same review target while the current Job is `pending` or `in_progress`.
   ```

   별도 wait command, local timeout, polling state를 추가하지 않는다.

4. `completed` Review Job의 `result`를 기존 independent review 처리 계약에 연결한다.

   Workpad에는 각 review target, Review Job ID, completed Result, finding, evidence-based acceptance 또는 rejection, fix, post-fix verification, re-review result를 기록한다. `Treat findings as review input, not automatic edit commands.` 계약과 current HEAD 검증, material actionable finding만 수정, affected verification 재실행, commit/push 규칙은 유지한다.

5. accepted finding 수정으로 HEAD가 바뀌면 새 HEAD를 대상으로 새로운 Review Job을 submit한다.

   ```text
   Fix only a material actionable finding with concrete evidence and observable impact; rerun affected verification, commit/push, and submit a new Review Job for the new HEAD.
   ```

   새 HEAD는 새로운 Review target이다. 기존 Job을 재사용하거나 다시 기다리지 않는다.

6. Review Job이 `failed`일 때는 기존 independent-review blocker handoff를 사용한다.

   ```text
   If the Review Job reaches `failed`, it has not passed this gate. Record the Job Error and current implementation/verification state in the Korean Workpad, move the task to `Human Review` with `reason: blocker`, confirm authoritative readback, and stop.
   ```

   `submit` 자체가 Job ID를 반환하기 전에 실패하는 경우의 기본 정책도 유지한다. submission error별 retry/recovery 정책을 새로 만들지 않으며 `SUBMISSION_UNCERTAIN`, `INVOCATION_CANCELLED`, `EXECUTION_TIMEOUT`에 대한 Notion Invocation 직접 inspection 문구는 제거한다.

7. 완료된 Review Job이 잘못된 PR, HEAD 또는 다른 review identity를 대상으로 했음이 확인되면 올바른 Review target으로 새로운 Job을 submit한다.

   ```text
   If a completed Review Job targeted the wrong PR, HEAD, or other review identity, correct the review target and submit a new Review Job. Treat this as a new review request, not as retry or recovery of the completed Job.
   ```

   이전 completed Job의 State나 Result를 수정하지 않는다. 잘못된 Review target을 확인하는 방법은 새 lifecycle 또는 reconciliation contract로 만들지 않는다.

8. Independent review 반복 종료 조건은 기존 의미를 유지한다.

   ```text
   Repeat until the Result is `PASS`, or all findings are resolved/rejected and no accepted fix produced a new HEAD.
   ```

   여기서 `Result`는 `completed` Review Job의 `result`다.

9. passing review 이후의 repository lifecycle은 변경하지 않는다.

   `passing review gate → Human Review preparation → State = Human Review → authoritative readback` 경로와 `Human Review → In Progress`, `Human Review → Rework`, `Human Review → Merging` 계약은 그대로 유지한다.

10. Worker wrapper는 현재 `chatgpt-shot` async Job public contract를 그대로 worker에게 노출한다.

    ```text
    chatgpt-shot submit "<prompt>"
    → 성공 시 stdout에 Job ID

    chatgpt-shot jobs <job-id>
    → 현재 Job snapshot
    ```

    Job snapshot에서 worker가 최소한 `state`, `result`, `error`를 구분할 수 있어야 한다. Leesh Loop 안에 별도의 Job store, wait command, retry state, submission history를 만들지 않는다.

11. `README.md`의 worker-facing `chatgpt-shot` interface 설명도 실제 계약과 일치시킨다.

    Worker 항목에 `chatgpt-shot submit "<prompt>"`와 `chatgpt-shot jobs <job-id>`를 모두 노출하고, `submit-only Service client` 표현을 제거한다. 다음 의미를 유지한다.

    ```text
    The worker command is a restricted Service client prepared in an Operator-owned interface
    directory. It supports only review Job submission and readback through `submit` and `jobs`;
    it does not run `doctor`, `start`, login, browser recovery, profile repair, or access the
    `chatgpt-shot` Notion credentials.
    ```

    README에는 async Job lifecycle의 상세 설명을 새로 추가하지 않는다. Worker가 사용할 수 있는 public surface와 Operator/Worker ownership boundary만 실제 구현과 맞춘다.

12. 이번 변경에서는 submission error별 retry/recovery 정책, submission error taxonomy, Job ID를 받지 못한 submission recovery, Service lifecycle 관리, 별도 review lifecycle State, Human Review lifecycle, repository State lifecycle, finding 유효성 판정 기준, merge contract를 새로 정의하거나 변경하지 않는다.

## Verification

대표 independent review를 실제 worker-facing `chatgpt-shot` interface를 통해 실행한다.

실제 중심 경로에서 현재 PR URL과 exact HEAD를 확정하고 `chatgpt-shot submit`으로 Job ID를 얻은 뒤 `chatgpt-shot jobs <job-id>`를 조회해 terminal State를 관찰한다. `completed`이면 `result`를 기존 finding validation / PASS 처리에 연결하고 기존 `Human Review` handoff를 수행한다. 실제 Job이 빠르게 terminal State에 도달해 `pending` 또는 `in_progress`를 관찰하지 못해도 중심 경로 검증은 유효하다.

다음 사항을 확인한다.

* `submit` stdout은 Review Result가 아니라 UUID다.
* `completed.result`가 기존 independent review Result 처리 경로에 연결된다.
* completed Result에 finding이 있고 수정으로 HEAD가 바뀌면 새 HEAD를 대상으로 새 Review Job이 생성된다.
* passing Result 이후 기존 `Human Review` handoff가 그대로 수행된다.
* `pending`/`in_progress`에서 30초 후 동일 Job을 재조회하고 같은 review target에 duplicate submit하지 않는다.
* `failed` Job은 Error readback, Workpad blocker 기록, `Human Review reason: blocker`, authoritative State readback으로 이어진다.
* Job ID 반환 전 submission failure는 기존 blocker 경로를 유지하고 새로운 taxonomy/retry/Invocation inspection을 추가하지 않는다.
* 잘못된 completed Review target은 retry/recovery가 아니라 현재 올바른 target의 새로운 Job으로 처리된다.
* README와 WORKFLOW에 옛 synchronous/submit-only 계약이 남아 있지 않고, 이번 계획 밖의 lifecycle 계약은 불필요하게 변경되지 않는다.

## Verification Tools

* 실제 worker-facing `chatgpt-shot` wrapper: `submit`의 Job ID 반환과 `jobs <job-id>` 조회 계약 확인.
* 실제 `chatgpt-shot` Service와 durable Job: terminal State와 Result/Error 확인.
* 실제 independent review prompt: PR과 exact HEAD를 대상으로 하는 review 중심 경로 확인.
* controllable Job fixture 또는 자동화 테스트: `pending`/`in_progress`에서 30초 후 동일 Job 재조회 및 duplicate submit 방지 확인.
* Notion Workpad와 task State readback: failed Job과 submission failure의 기존 blocker handoff, passing review 이후 `Human Review` 전환 확인.
* Git/GitHub: review target의 PR/HEAD와 수정 후 새 HEAD에 대한 새로운 review request 확인.
* README inspection 및 최종 diff inspection: worker-facing public surface와 Operator/Worker ownership 설명, async review 계약 범위 확인.
* `git diff --check`: whitespace 오류와 범위 밖 변경 확인.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `636ba3fca1ad65f04f3e806926105a664c612ff1` on [PR #30](https://github.com/leesh7807/leesh-loop/pull/30).
- Verdict: `FINDINGS`.
- Accepted the readiness finding: after async submission, Operator smoke readiness checked only
  that a Job ID existed and did not preserve the previous terminal Result verification. Updated
  bootstrap to read the same Job until `completed`/`failed` and require a non-empty completed
  Result. This is readiness verification, not a worker-side review lifecycle or retry policy.
- Applied commit: `c372f3f63f883b4c73b67db2ca32ac4e323bcb99`.
- Verification: `sh -n`, operator app tests (13/13), Notion publisher tests (23/23), and
  `git diff --check` passed.

### Round 2

- Reviewed HEAD: `37c16e0cf165de42ada3de6b15b71aeb0fd913f2` on [PR #30](https://github.com/leesh7807/leesh-loop/pull/30).
- Verdict: `PASS`; completed Result reported `# Findings` as `None.`.
- The readiness correction was independently re-reviewed at the new HEAD; no additional
  evidence-based finding was reported.
- Applied commit: none after the Round 1 correction and review-log commits.
- Verification: the actual worker-facing `submit` returned Job ID
  `9557d321-c539-462a-961b-af00c7820436`; polling the same Job through `jobs` reached
  `completed` with `error: null` and the PASS Result. Local tests and `git diff --check` passed.
