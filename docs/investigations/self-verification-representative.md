# Self-verification representative investigation

## Observed boundary

The repository's lifecycle documentation assigns persistent external-tool readiness to the
Operator and leaves the worker a narrow interface: repository work inside its assigned workspace
and `chatgpt-shot submit "<prompt>"` / `chatgpt-shot jobs <job-id>`. The task surface remains the
authority for whether work is active.

This run observed that boundary through the configured task surface. The task was read in
`Ready` with an empty canonical Workpad. After the dispatch context was recorded, the task was
transitioned to `In Progress` and read back authoritatively. The worker then continued inside the
existing task workspace on the task branch. No production lifecycle authority, Tracker state
semantics, or Symphony orchestration was changed.

## Exact commands and task-surface operations used

Repository inspection used these commands:

```sh
git status --short --branch && git log -1 --oneline
rg --files -g 'AGENTS.md' -g 'docs/WORKFLOW_TEMPLATE.md' -g 'README.md' -g 'PLAN.md' -g 'WORKFLOW.md' -g 'REVIEW.md' -g 'docs/**' -g '!operator/symphony/**' | sort
sed -n '1,220p' docs/WORKFLOW_TEMPLATE.md
sed -n '1,220p' docs/plans/completed/2026-09-14-operator-runtime-readiness.md
rg -n "chatgpt-shot|Human Review|set_state|origin/|base branch|Review Job|jobs <job-id>" operator --glob '!operator/symphony/**' | head -240
```

The task-surface operations were `notion_task_read`, `notion_task_read_workpad`,
`notion_task_append_workpad`, `notion_task_set_state`, and a final `notion_task_read` authoritative
readback. The worker-facing `chatgpt-shot` commands remain limited to the documented
`chatgpt-shot submit "<prompt>"` and `chatgpt-shot jobs <job-id>` forms; Service management is an
Operator concern.

## Conclusion

The representative production observation matches the documented lifecycle boundary: task State
authorizes active worker execution, while external-tool readiness and Service lifecycle remain
outside the worker. This investigation required only a durable documentation artifact and did not
justify a lifecycle or orchestration change.
