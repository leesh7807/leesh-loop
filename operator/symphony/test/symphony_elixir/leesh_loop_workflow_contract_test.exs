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
    assert prompt =~ "`Backlog` is non-active, non-terminal, and never dispatchable"
    assert prompt =~ "delivered_pr: <PR URL or number | none>"
    assert prompt =~ "origin_base: <resolved-remote-base-commit>"
    assert prompt =~ "remote_base: <configured-base remote commit | none>"
    assert prompt =~ "fetch and resolve the configured remote base"
    assert prompt =~ "create the PR with explicit configured base"
    assert prompt =~ "Use task-bound Local Task tools"
    refute prompt =~ "notion_task_"
    refute prompt =~ "origin/main"
    refute prompt =~ "remote `main`"
  end
end
