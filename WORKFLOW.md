---
# The Notion adapter owns provider credentials and its concrete schema. These are
# the repository's intended state names once that adapter is configured.
tracker:
  kind: notion
  provider:
    database_url: $LEESH_LOOP_NOTION_DATABASE_URL
  active_states:
    - Ready
    - In Progress
    - Rework
  terminal_states:
    - Done
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: $SYMPHONY_WORKSPACE_ROOT
hooks:
  # Symphony executes this only for a newly-created workspace. Continuations use
  # the preserved workspace and are never reset by this workflow.
  after_create: |
    git clone https://github.com/leesh7807/leesh-loop.git .
    (cd notion_publisher && npm ci)
    if command -v mise >/dev/null 2>&1; then
      (cd symphony && mise trust && mise exec -- mix deps.get)
    else
      (cd symphony && mix deps.get)
    fi
agent:
  max_turns: 20
codex:
  command: codex app-server
---

# Leesh Loop repository workflow

You are working on an Accepted Plan task.

- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- Current state: {{ issue.state }}
- URL: {{ issue.url }}

Accepted Plan:

{{ issue.description }}

{% if attempt %}
This is a Symphony continuation or retry. Resume the existing workspace state; do not restart fresh-workspace setup or repeat completed work unless later changes require it.
{% endif %}

Read `AGENTS.md`, then apply [`docs/WORKFLOW_TEMPLATE.md`](docs/WORKFLOW_TEMPLATE.md). The template is the reusable Plan-based execution policy; this file supplies this repository's concrete rules.

## Workspace and task surface

The `after_create` hook clones this repository and installs its worker dependencies before the agent starts. Work only in the Symphony-provided workspace. Do not modify `symphony/` unless the Accepted Plan specifically requires it.

Use the Notion task surface for the Accepted Plan, Workpad, and state changes. Write the Workpad in Korean; preserve code, commands, identifiers, paths, API names, and quotations verbatim where accuracy requires it. If that task surface or required authentication is unavailable, record the cause and current repository/verification state in Korean, move the task to `Human Handoff`, confirm the state readback, and stop. `Human Handoff` is non-active and non-terminal; it becomes runnable again only when a human returns it to an active state.

## Repository state and delivery

The repository state vocabulary is:

- `Ready`, `In Progress`, and `Rework` are active states. Move `Ready` work to `In Progress` before implementation; use `Rework` for review-driven work.
- `Human Handoff` is the non-active, non-terminal state for an external blocker, including a failed independent review invocation.
- `Human Review` is the non-active, non-terminal state after a validated PR and successful independent-review gate, awaiting human review or merge.
- `Done` and `Cancelled` are terminal states. Move to `Done` only after the full repository lifecycle, including required human review/merge, has actually ended. Never use terminal state merely because implementation, verification, or independent review finished.

Create a task branch, make only task-related commits, push it, and open a PR against `main`; never merge directly to `main`. Before handoff, inspect the final diff and status, run applicable repository checks and `git diff --check`, and compare the actual result with the Repository Plan as required by the reusable template. Record material verification, contract decisions, root causes, and artifact changes as PR comments when a PR exists.

## Independent `chatgpt-shot` review gate

After implementation and ordinary repository verification, obtain the current PR URL and `git rev-parse HEAD`, then submit this request through the supported public interface `chatgpt-shot submit` and use its completed stdout Result:

```text
PR <PR_URL>의 HEAD <HEAD_SHA>를 코드 리뷰하라.

지정 HEAD의 실제 원문을 확인한 뒤에만 finding을 확정하라. 영향도와 재현 가능성을 기준으로 실제 결함만 보고하라. 개선 가능성, 스타일, 추측, 의도된 동작은 finding이 아니다.

각 finding에는 severity, 제목, 파일:줄, 실제 코드 근거, 재현 경로, 영향, 결함인 이유, confidence를 포함하라. 모든 결과는 하나의 Markdown 문서로 출력하라.

형식:
# Verdict
PASS | FINDINGS

# Findings
- [severity] 제목
  - Location:
  - Evidence:
  - Reproduction:
  - Impact:
  - Why defect:
  - Confidence:

finding이 없으면 `None.`만 출력하라.
```

Give the request enough Accepted Plan and changed-result context to judge the objective, as well as the PR and HEAD identity. Record each review target, result, finding, evidence-based acceptance or rejection, fix, post-fix verification, and re-review result in the Korean Workpad. Do not copy the full transcript into the Repository Plan.

Treat findings as review input, not automatic edit commands. Independently validate each finding against the current HEAD and its execution path. Fix only a material actionable finding with concrete evidence and observable impact; rerun affected verification, commit/push, and review the new HEAD. Record a rejection reason without editing for findings that are not valid. Repeat until the Result is `PASS`, or all findings are resolved/rejected and no accepted fix produced a new HEAD.

If `chatgpt-shot` does not complete normally, it has not passed this gate. Record the failure reason and current implementation/verification state in the Korean Workpad, move the task to `Human Handoff`, confirm readback, and stop. Do not create an automatic recovery or failure-code retry policy. For `SUBMISSION_UNCERTAIN`, `INVOCATION_CANCELLED`, or `EXECUTION_TIMEOUT`, inspect the Notion Invocation before any resubmission.

After a passing review gate, move the task to `Human Review` with authoritative readback. A human may return it to `Rework`; then perform the required verification and independent review again before returning it to `Human Review`.
