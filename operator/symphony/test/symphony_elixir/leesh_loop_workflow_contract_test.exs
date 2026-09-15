defmodule SymphonyElixir.LeeshLoopWorkflowContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workflow

  test "repository workflow dispatches Merging and preserves terminal states" do
    workflow_path = Path.expand("../../../../WORKFLOW.md", __DIR__)

    assert {:ok, %{config: %{"tracker" => tracker}}} = Workflow.load(workflow_path)
    assert tracker["active_states"] == ["Ready", "In Progress", "Rework", "Merging"]
    assert tracker["terminal_states"] == ["Done", "Cancelled"]
  end
end
