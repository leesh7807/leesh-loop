defmodule SymphonyElixir.NotionWorkerCapabilityTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.AgentTool

  test "worker advertises publication and current-task relation capabilities separately" do
    specs = AgentTool.tool_specs()
    assert Enum.any?(specs, &(&1["name"] == "notion_task_publish_plan"))
    assert Enum.any?(specs, &(&1["name"] == "notion_task_add_blocked_by"))
    refute Enum.any?(specs, &(&1["name"] == "notion_task_manage_relation"))
  end

  test "worker publication is separate and uses the supplied Publisher result" do
    response =
      AgentTool.execute(
        "notion_task_publish_plan",
        %{"plan" => "# Follow-up\naccepted"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: fn "GET", "/pages/task-a", _params, nil, _settings -> scope_response() end,
        publisher_runner: fn plan, _settings ->
          send(self(), {:published_plan, plan})
          {:ok, %{"identifier" => "PLAN-B", "page_id" => "page-b"}}
        end
      )

    assert response["success"]
    assert_receive {:published_plan, "# Follow-up\naccepted"}
    assert Jason.decode!(response["output"]) == %{"identifier" => "PLAN-B", "page_id" => "page-b"}
  end

  test "Publisher failure is returned without a worker fallback" do
    response =
      AgentTool.execute(
        "notion_task_publish_plan",
        %{"plan" => "# Follow-up\naccepted"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: fn "GET", "/pages/task-a", _params, nil, _settings -> scope_response() end,
        publisher_runner: fn _plan, _settings -> {:error, :publisher_unavailable} end
      )

    refute response["success"]
    assert response["output"] =~ "publisher_unavailable"
  end

  test "current-task blocker update preserves existing relations and is additive" do
    request = current_task_request(self(), has_more: true)

    response =
      AgentTool.execute(
        "notion_task_add_blocked_by",
        %{"blocker_page_id" => "page-b"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: request
      )

    assert response["success"]
    result = Jason.decode!(response["output"])
    assert result["added"]
    assert result["blocked_by_page_ids"] == ["page-c", "page-d", "page-b"]
    assert_receive {:blocked_by_patch, %{"properties" => %{"Blocked By" => %{"relation" => relation}}}}
    assert Enum.map(relation, & &1["id"]) == ["page-c", "page-d", "page-b"]
  end

  test "a blocker outside the bound task data source is rejected before mutation" do
    response =
      AgentTool.execute(
        "notion_task_add_blocked_by",
        %{"blocker_page_id" => "task-d"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: fn
          "GET", "/pages/task-a", _params, nil, _settings -> {:ok, task_page("task-a", "source", ["page-c"])}
          "GET", "/pages/task-d", _params, nil, _settings -> {:ok, task_page("task-d", "other-source", [])}
          "PATCH", _path, _params, _body, _settings -> flunk("out-of-scope blocker must not be mutated")
        end
      )

    refute response["success"]
    assert response["output"] =~ "notion_out_of_scope_blocker"
  end

  test "a target-task mutation argument is rejected before any relation request" do
    response =
      AgentTool.execute(
        "notion_task_add_blocked_by",
        %{"blocker_page_id" => "page-b", "target_task_page_id" => "task-d"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: fn _method, _path, _params, _body, _settings ->
          flunk("arbitrary target-task arguments must be rejected before Notion access")
        end
      )

    refute response["success"]
    assert response["output"] =~ "invalid_notion_tool_arguments"
  end

  test "current-task relation provider failure is returned" do
    response =
      AgentTool.execute(
        "notion_task_add_blocked_by",
        %{"blocker_page_id" => "page-b"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task-a"},
        notion_request: fn
          "GET", "/pages/task-a", _params, nil, _settings -> {:ok, task_page("task-a", "source", [])}
          "GET", "/pages/page-b", _params, nil, _settings -> {:ok, task_page("page-b", "source", [])}
          "PATCH", "/pages/task-a", _params, _body, _settings -> {:error, :notion_rate_limited}
        end
      )

    refute response["success"]
    assert response["output"] =~ "notion_rate_limited"
  end

  defp notion_settings, do: %{token: "token", database_id: "database", terminal_states: ["Done", "Cancelled"]}

  defp scope_response, do: {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

  defp current_task_request(test_pid, opts) do
    has_more = Keyword.get(opts, :has_more, false)

    fn
      "GET", "/pages/task-a", _params, nil, _settings ->
        {:ok, task_page("task-a", "source", ["page-c"], has_more)}

      "GET", "/pages/page-b", _params, nil, _settings ->
        {:ok, task_page("page-b", "source", [])}

      "GET", "/pages/task-a/properties/blocked-prop", _params, nil, _settings ->
        {:ok, %{"results" => [%{"type" => "relation", "relation" => %{"id" => "page-c"}}, %{"type" => "relation", "relation" => %{"id" => "page-d"}}], "has_more" => false}}

      "PATCH", "/pages/task-a", _params, body, _settings ->
        send(test_pid, {:blocked_by_patch, body})
        {:ok, %{"id" => "task-a"}}
    end
  end

  defp task_page(id, source, blocker_ids, has_more \\ false) do
    %{
      "id" => id,
      "parent" => %{"type" => "data_source_id", "data_source_id" => source},
      "properties" => %{
        "Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "PLAN-#{id}"}]},
        "Title" => %{"type" => "title", "title" => [%{"plain_text" => id}]},
        "State" => %{"type" => "select", "select" => %{"name" => "Ready"}},
        "Priority" => %{"type" => "number", "number" => 3},
        "Labels" => %{"type" => "multi_select", "multi_select" => []},
        "Blocked By" => %{"id" => "blocked-prop", "type" => "relation", "relation" => Enum.map(blocker_ids, &%{"id" => &1}), "has_more" => has_more},
        "Plan" => %{"type" => "relation", "relation" => [%{"id" => "plan-#{id}"}]}
      }
    }
  end
end
