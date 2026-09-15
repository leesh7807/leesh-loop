# 2026-09-15-timing-boundary-test-stability

## Objective

Stabilize the Symphony retry timing-boundary tests on the current `main` repository structure without changing production retry scheduling behavior unless new deterministic evidence demonstrates an actual production defect.

The current failure mode is expected to be a test-boundary defect: retry scheduling calculates a fixed monotonic due time, while the existing tests derive a lower remaining-time bound from a later observation timestamp. Elapsed time between scheduling and observation can therefore make a correct due time fail the assertion.

Demonstrate that relationship deterministically, then make the tests verify the scheduled due time against the scheduling-associated monotonic timestamp rather than a later observation.

This work must be implemented from the current repository state. Do not checkout, merge, cherry-pick, or otherwise reuse PR #18 as the implementation source.

## Current repository scope

Locate the current Symphony retry implementation and tests from the repository itself.

The expected current locations are under:

* `operator/symphony/lib/symphony_elixir/`
* `operator/symphony/test/symphony_elixir/`

Do not assume paths or implementation details from an older branch if the current repository differs.

## Required behavior

Preserve the existing production retry scheduling semantics.

In particular:

* the requested retry delay must remain the delay used for actual retry scheduling;
* the stored/calculated due time must represent that same scheduling decision;
* retry attempt progression and stale-timer behavior must remain unchanged;
* no production timing tolerance, artificial delay, or scheduling behavior may be introduced merely to satisfy tests.

If investigation instead demonstrates an actual production scheduling defect, record the evidence before changing production behavior and limit the correction to that demonstrated defect.

## Investigation

Inspect the current retry scheduling path and affected tests.

Capture the relationship between:

* requested retry delay;
* monotonic timestamp associated with scheduling;
* calculated due time;
* later test observation timestamp;
* existing lower and upper assertion bounds.

Demonstrate deterministically that the existing assertion can reject a correct due time because its lower bound advances with the later observation timestamp while the already-calculated due time remains fixed.

Do not depend on naturally reproducing a flaky failure.

A controlled delay or equivalent deterministic test seam may be used only to demonstrate this timing relationship. It must not become a broad sleep-based stabilization mechanism.

## Correction

Prefer exposing or capturing the monotonic timestamp actually associated with the production due-time calculation and asserting:

```text
due_at = scheduling_timestamp + requested_delay
```

If a test-only observation seam is necessary:

* it must be nil/inactive by default;
* it must not alter production scheduling behavior;
* it must expose only information already produced by the scheduling path;
* it must not create a second timing source approximating the production timestamp.

Do not solve the issue by:

* increasing sleeps;
* widening timing ranges;
* adding arbitrary timing tolerance;
* retrying flaky assertions;
* changing production delays solely to satisfy tests.

## Regression coverage

Cover at minimum:

* continuation scheduling after a normal worker exit;
* progressively delayed retry after an abnormal worker exit;
* initial retry delay after an abnormal worker exit.

Preserve retry attempt metadata and existing retry lifecycle behavior.

Include deterministic evidence showing that the original later-observation lower-bound assertion can reject an otherwise correct scheduled due time.

## Verification

Required verification:

* targeted affected timing-boundary tests pass for 100 consecutive runs;
* affected Symphony scheduler/retry tests pass;
* no related Symphony tests regress;
* production retry scheduling behavior remains unchanged unless deterministic evidence proved a production defect;
* final diff is inspected specifically for unintended scheduling changes;
* `git diff --check` passes.

Record representative verification and results in the Workpad.

## Repository delivery

Follow the repository workflow from the current `main` clone created for this task.

Create a fresh task branch, make task-related commits, push it, and open a new PR against `main`.

Do not reuse PR #18 or its branch as the delivery artifact.

Before handoff:

* inspect final diff/status;
* compare implementation against this Plan;
* move the Repository Plan from active to completed;
* record material implementation and verification results in the Workpad.

## Independent review

After normal verification, obtain the new PR URL and exact HEAD SHA.

Use the supported worker-facing `chatgpt-shot submit` interface for independent review.

Additional criteria:

* deterministic evidence must establish the later-observation boundary defect;
* corrected assertions must use the scheduling-associated monotonic timestamp or equally exact scheduling evidence;
* no broad sleep or loose timing range may be used as flake suppression;
* production scheduling behavior must remain unchanged unless separately proven defective;
* targeted tests must pass 100 consecutive runs;
* affected scheduler/retry tests and `git diff --check` must pass.

Validate findings independently against the exact reviewed HEAD.

Fix only evidence-backed material defects and re-review every fix-created HEAD.

## Handoff

After implementation, verification, new PR creation, and passing independent review:

1. append final implementation, verification, PR, HEAD, and review result to Workpad;
2. prepare the next Human Review cycle according to `WORKFLOW.md`;
3. transition the task to `Human Review`;
4. confirm authoritative state readback;
5. stop automated work.

Do not transition to `Done`.
