# 2026-09-27-project-git-target-config-3

Add a short Git target subsection to `docs/SYSTEM.md` with an example showing `github_repository_url` and `github_base_branch` together. State that the two fields are configured as a pair, `main` is only an example, and the configured base is used for task workspaces/branches and delivery PRs. Keep the change documentation-only. Verify the field names and behavior against the root `README.md` and `operator/app`, then run `git diff --check`.
