defmodule SymphonyElixir.LeeshLoopWorkflowContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workflow

  test "repository workflow declares Backlog as non-dispatch and preserves lifecycle states" do
    workflow_path = Path.expand("../../../../WORKFLOW.md", __DIR__)

    assert {:ok, %{config: %{"tracker" => tracker}}} = Workflow.load(workflow_path)
    assert tracker["active_states"] == ["Ready", "In Progress", "Rework", "Merging"]
    assert tracker["terminal_states"] == ["Done", "Cancelled"]

    refute "Backlog" in tracker["active_states"]
    refute "Backlog" in tracker["terminal_states"]

    assert {:ok, %{prompt: prompt}} = Workflow.load(workflow_path)
    assert prompt =~ "`Backlog` is a normal non-active, non-terminal waiting state"
    assert prompt =~ "delivered_pr: <PR URL or number | none>"
    assert prompt =~ "origin_base: <resolved-remote-base-commit>"
    assert prompt =~ "remote_base: <configured-base remote commit | none>"
    assert prompt =~ "git fetch origin \"$SYMPHONY_GITHUB_BASE_BRANCH\""
    assert prompt =~ "gh pr create --base \"$SYMPHONY_GITHUB_BASE_BRANCH\""
    refute prompt =~ "origin/main"
    refute prompt =~ "remote `main`"
  end
end
