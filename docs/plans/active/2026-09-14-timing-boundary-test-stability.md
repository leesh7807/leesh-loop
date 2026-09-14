# 2026-09-14-timing-boundary-test-stability

## Objective

Resolve the retry timing-boundary test failure as a test-boundary defect while preserving
production scheduling behavior. The test must verify a due time against the scheduling-associated
monotonic timestamp, or use only the smallest observation tolerance justified by evidence.

## Definitions

- **Requested delay**: the delay selected by retry scheduling for a retry attempt.
- **Scheduling timestamp**: the monotonic millisecond timestamp used as the reference for the
  calculated due time.
- **Calculated due time**: the stored monotonic timestamp equal to the scheduling timestamp plus
  the requested delay.
- **Observation timestamp**: the monotonic timestamp sampled later by the test while asserting the
  due-time bounds.
- **Observation delay**: elapsed monotonic time between scheduling and the test's observation.

## Intent

The retry scheduler currently uses the same requested delay for `Process.send_after/3` and the
monotonic due-time calculation. The failing assertion derives its lower bound from a later
observation timestamp, so elapsed observation time can make a correctly calculated due time appear
too close to the present. The investigation must preserve the original assertion and then show
this relationship deterministically before changing the test.

## Decisions

- Treat the current failure as a test-boundary problem unless deterministic evidence demonstrates
  an incorrect production delay calculation.
- Keep production scheduling code unchanged unless that evidence proves a production defect.
- Capture the requested delay, scheduling timestamp where observable, calculated due time,
  observation timestamp, elapsed observation delay, and assertion bounds.
- The original assertions were remaining-time bounds of `[500, 1_100]` for the 1,000 ms
  continuation, `[39_500, 40_500]` for the 40,000 ms retry, and `[9_000, 10_500]` for the
  10,000 ms retry; those lower bounds were relative to the later observation timestamp.
- Add a controlled delay only at the test seam when needed to demonstrate the lower-bound defect;
  do not add a broad sleep or loosen the timing window as a flake suppressor.
- Prefer asserting against a captured scheduling timestamp. Because the exact internal clock read
  is not otherwise observable, use an optional nil-by-default test observer to report the timestamp
  already used for due-time calculation. The observer has no production effect when unset, and
  synchronous state observation avoids an arbitrary observation sleep.
- Verify the targeted timing-boundary test 100 consecutive times, run the affected scheduler/retry
  suite, confirm production scheduling is unchanged, and run `git diff --check`.
- After local verification, submit the exact PR URL and `git rev-parse HEAD` to `chatgpt-shot`.
  Independently validate each finding against that HEAD; fix only evidence-backed defects,
  record rejected findings, and repeat review after every fix-created HEAD until the review passes
  or all findings are rejected without a new HEAD.

## Verification

- The original lower-bound assertion is preserved in the investigation evidence or regression
  test history, including its actual bounds.
- A deterministic test-seam delay demonstrates that the later observation timestamp advances the
  existing lower bound while the already-calculated due time remains fixed, and that a correct
  production due time can therefore be rejected.
- The corrected assertion uses the scheduling-associated timestamp (or a minimal justified
  tolerance) and passes through the normal orchestrator retry path. The optional test observer
  does not alter production scheduling behavior.
- The targeted timing-boundary test passes 100 consecutive runs with no failures, the affected
  scheduler/retry tests pass, production scheduling code is unchanged unless proven defective,
  and `git diff --check` passes.
- The final PR/HEAD identity is reviewed by `chatgpt-shot`; every material finding is independently
  reproduced or rejected with a recorded reason and the post-fix verification result.

## Verification Tools

- `mix test test/symphony_elixir/core_test.exs --only ...` exercises the real GenServer retry path
  for targeted timing tests.
- A controlled test seam and monotonic timestamp captures provide direct evidence of the scheduling
  and observation boundary without changing timer behavior.
- `mix test test/symphony_elixir/core_test.exs` verifies the affected scheduler/retry suite.
- `git diff`, `git show`, and `git diff --check` confirm scope, original assertion context, and
  whitespace integrity; `git diff` also confirms whether production scheduling changed.
- `chatgpt-shot submit` provides the independent review Result for the exact PR URL and HEAD.

## chatgpt-shot review log

### Round 1

- Reviewed HEAD: `574ed71e31fcc639836c7c9067d844d7014201be` on [PR #18](https://github.com/leesh7807/leesh-loop/pull/18).
- Verdict: `FINDINGS` (one medium finding).
- Finding disposition: accepted; the assertion used a pre-trigger proxy and retained a tolerance instead of the exact scheduler timestamp, and the committed tests did not execute the deterministic original-lower-bound rejection evidence.
- Applied commit: `7e74b9f785f9931dae6b1fc4d7c4a088d5852e68`.
- Verification: the observer now captures the production clock read and the test asserts the exact due formula; a controlled +600 ms observation proves the original +500 ms lower bound rejects the correct due time. Targeted retry tests and `CoreTest` passed; re-review is required for the new HEAD.
