# 2026-09-30-symphony-hex-advisory-remediation

## Objective

Update Symphony's locked Hex dependencies so packages flagged by the Hex advisory audit against the dependency lock at task start resolve to fixed, non-affected releases, while preserving Leesh Loop's existing Symphony runtime behavior and contracts.

## Intent

The Generated Loop now prepares Symphony dependencies from its own snapshot of `operator/symphony/mix.exs` and `operator/symphony/mix.lock`. The real preparation path reported multiple locked packages as vulnerable, including HIGH-severity advisories. Dependency version changes were intentionally outside the accepted init task, so this follow-up isolates the audit and remediation from Loop generation behavior.

## Verification Requirements

- Every package version in the task-start Symphony lockfile that the current Hex advisory audit marks vulnerable resolves to a fixed or otherwise non-affected version in the updated lockfile; the audit is not disabled, suppressed, or bypassed.
- The same lockfile and dependency preparation used by a Generated Loop produce no vulnerable-package advisory for the packages in scope.
- Symphony compiles and its applicable tests pass with the updated dependencies, and the existing workflow parsing, tracker, Operator-to-Symphony, and worker execution contracts remain intact.
- Dependency changes preserve existing supported normal behavior and runtime contracts. The security behavior change required to correct the advisory's vulnerable input handling is allowed; unrelated changes, or changes to supported normal behavior and contracts, are not silently accepted.
- If an advisory has no fixed release that can be adopted while preserving those contracts, the task reports the exact remaining package/advisory, compatibility evidence, and required human decision instead of suppressing the finding or claiming complete remediation.

## Definitions

- **Task-start lockfile**: `operator/symphony/mix.lock` as it exists when this follow-up begins implementation.
- **Flagged package**: a package version in the task-start lockfile that the Hex advisory audit reports as vulnerable at that time.
- **Fixed release**: a release outside the affected version range recorded by the advisory source.

## Decisions

- Keep `operator/symphony/mix.exs` constraints and `mix.lock` as the only Hex dependency authorities; update direct constraints only when needed to resolve affected transitive versions.
- Do not silence audit output, add advisory exceptions, or vendor patched package code.
- Preserve existing supported runtime behavior and contracts. Permit the specific vulnerable-input handling change required by remediation and make no unrelated behavior changes. If remediation requires broader behavior or contract changes, stop for human review.
- `operator/symphony/` is in scope for this follow-up because its locked dependencies are the observed issue and it is the runtime being remediated.

## Verification

- Record the current advisory findings and affected lock entries at task start; inspect dependency constraints and advisory fixed ranges before changing versions.
- Resolve dependencies through the repository's ordinary `mise exec -- mix deps.get` path and read back the lockfile. Confirm every task-start flagged package is fixed/non-affected and the audit reports no vulnerable version for those packages.
- Run `mise exec -- mix compile` and the Symphony test suite with the updated dependency graph.
- Exercise the generated-workflow parser and the existing runtime integration tests affected by the dependency changes. Compare externally visible workflow, tracker, lifecycle, and worker behavior with the pre-change contracts.
- Inspect final changes and `git diff --check`; verify no audit-suppression mechanism or unrelated runtime change was introduced.

## Verification Tools

- Hex `mix deps.get` advisory output and the advisory's published affected/fixed ranges: identify and verify package versions.
- `operator/symphony/mix.exs` and `mix.lock`: authoritative constraints and resolved versions.
- `mise exec -- mix compile` and `mise exec -- mix test`: dependency compilation and runtime regression evidence.
- Existing Symphony workflow/parser and Operator integration tests: verify surrounding production contracts.
