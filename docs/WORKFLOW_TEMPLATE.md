# Leesh Loop workflow template

This template defines reusable execution-contract semantics. A target repository owns its concrete `WORKFLOW.md`, which combines Symphony runtime configuration in YAML front matter with this contract as its Markdown worker prompt. Add repository-specific commands, paths, delivery requirements, and review integrations only in that repository workflow.

## Read the accepted task

Read the task and its accepted Plan before making changes. Treat the Plan as the durable baseline for the accepted objective, boundaries, decisions, assumptions, constraints, and verification design. It is not an immutable prediction of implementation steps.

Follow the target repository's guidance and use its intended entry points. Keep repository-wide rules authoritative; this template supplies common execution semantics rather than replacing them.

## Execute from evidence

Use repository and runtime evidence to complete the accepted objective. Execution discovery is expected, including facts and constraints that could not be known with sufficient confidence during planning. You may autonomously change the implementation approach, touch additional necessary components, add required tests or verification, replace a disproved technical assumption, and refine a verification method that cannot prove the result. Work necessary for the accepted objective remains in the current task even if it was not anticipated in the Plan.

Do not ask for approval solely because the actual implementation path differs from the Plan.

## Keep durable knowledge and execution state separate

Update the repository Plan when execution reveals durable planning knowledge: a material correction to an assumption, responsibility boundary, constraint, accepted implementation requirement, verification method, or repository/integration behavior that remains relevant after the task ends. Updating the Plan for such a discovery does not itself require human approval.

Use the mutable Workpad for transient state: progress, attempts, command output, temporary failures, investigation notes, intermediate evidence, blockers, and handoff state. Do not turn the Plan into an execution log. A resolved command failure belongs in the Workpad; proof that a material Plan assumption was false belongs in the Plan as durable knowledge.

## Separate follow-up work

When concrete evidence reveals meaningful work not required for the current accepted objective, do not expand the current task. Define separate follow-up work only when its outcome is independently understandable, completion is independently judgeable, and defining it does not require a new material product or contract decision. Do not create speculative follow-ups for optional improvements.

The intended follow-up route is: execution discovery → follow-up Plan artifact → Publisher → normal tracked task. This contract does not require or describe the agent's Publisher invocation, tracker mutation mechanics, or relation writing.

## Return to human judgment

Stop and surface the decision when new evidence requires changing the accepted objective, a material product decision, a material external contract or compatibility decision, an accepted boundary into a materially different capability, or choosing among materially consequential alternatives not already settled. Do not escalate ordinary implementation discovery, failed approaches, required additional work, or verification refinement.

## Verify and complete

Verify the representative intended flow through the repository's direct practical interface. Record transient evidence and handoff state in the Workpad; preserve durable corrections in the repository Plan. Complete only when the accepted objective and verification evidence are satisfied, repository-specific delivery requirements have been met, and any required human decision has been surfaced rather than silently made.

## Repository extension points

The repository-owned workflow supplies the concrete instructions for its setup and commands, branch and review flow, verification surfaces, delivery mechanism, and any independent review. It must retain Symphony's structure: optional YAML front matter for runtime configuration followed by a Markdown prompt body.
