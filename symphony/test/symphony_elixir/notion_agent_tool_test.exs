defmodule SymphonyElixir.Notion.AgentToolTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.AgentTool

  test "append workpad writes directly to the bound task page" do
    response =
      AgentTool.execute(
        "notion_task_append_workpad",
        %{"text" => "실행 결과"},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
        notion_request: fn
          "GET", "/pages/task", _params, nil, _settings ->
            send(self(), :task_scope_check)
            {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

          "PATCH", "/blocks/task/children", _params, body, _settings ->
            send(self(), {:workpad_append, body})
            {:ok, %{"results" => [%{"id" => "new-block"}]}}
        end
      )

    assert response["success"]
    assert_received :task_scope_check
    assert_received {:workpad_append, %{"children" => [%{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"text" => %{"content" => "실행 결과"}}]}}]}}
  end

  test "comments remain task-local and paginated independently from Workpad" do
    response =
      AgentTool.execute(
        "notion_task_comments",
        %{},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
        notion_request: fn
          "GET", "/pages/task", _params, nil, _settings ->
            {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

          "GET", "/comments", params, nil, _settings ->
            case params["start_cursor"] do
              nil -> {:ok, %{"results" => [%{"id" => "comment-1"}], "has_more" => true, "next_cursor" => "cursor-2"}}
              "cursor-2" -> {:ok, %{"results" => [%{"id" => "comment-2"}], "has_more" => false}}
            end
        end
      )

    assert response["success"]
    assert response["output"] =~ "comment-1"
    assert response["output"] =~ "comment-2"
  end

  test "read returns the bound task page" do
    response =
      AgentTool.execute(
        "notion_task_read",
        %{},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
        notion_request: fn
          "GET", "/pages/task", _params, nil, _settings ->
            {:ok,
             %{
               "id" => "task",
               "parent" => %{"type" => "data_source_id", "data_source_id" => "source"},
               "properties" => %{}
             }}
        end
      )

    assert response["success"]
    assert response["output"] =~ "task"
  end

  test "unbound, unsupported, invalid argument, and scope failures stay explicit" do
    assert AgentTool.execute("notion_task_read", %{}, tracker_settings: notion_settings())["output"] =~ "notion_unbound_task"

    assert AgentTool.execute(
             "unsupported",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"}
           )["output"] =~ "unsupported_notion_tool"

    assert AgentTool.execute(
             "notion_task_set_state",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"}
           )["output"] =~ "invalid_notion_tool_arguments"

    assert AgentTool.execute(
             "notion_task_append_workpad",
             %{"text" => ""},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"}
           )["output"] =~ "invalid_notion_tool_arguments"

    out_of_scope = fn "GET", "/pages/task", _params, nil, _settings -> {:ok, %{"parent" => %{"type" => "page_id", "page_id" => "other"}}} end

    assert AgentTool.execute(
             "notion_task_comments",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: out_of_scope
           )["output"] =~ "notion_out_of_scope_task"

    assert AgentTool.execute(
             "notion_task_append_workpad",
             %{"text" => "result"},
             tracker_settings: notion_settings(),
             tracker_binding: %{},
             issue: %{id: "task"}
           )["output"] =~ "notion_unbound_task"

    malformed_scope = fn "GET", "/pages/task", _params, nil, _settings -> {:ok, %{"parent" => :malformed}} end

    assert AgentTool.execute(
             "notion_task_read",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: malformed_scope
           )["output"] =~ "notion_out_of_scope_task"

    scope_error = fn "GET", "/pages/task", _params, nil, _settings -> {:error, :notion_not_found} end

    assert AgentTool.execute(
             "notion_task_read",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: scope_error
           )["output"] =~ "notion_not_found"

    assert AgentTool.execute(
             "notion_task_set_state",
             [],
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"}
           )["output"] =~ "invalid_notion_tool_arguments"
  end

  test "comment provider and pagination failures are returned" do
    provider_error = fn
      "GET", "/pages/task", _params, nil, _settings ->
        {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

      "GET", "/comments", _params, nil, _settings ->
        {:error, :notion_rate_limited}
    end

    assert AgentTool.execute(
             "notion_task_comments",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: provider_error
           )["output"] =~ "notion_rate_limited"

    malformed = fn
      "GET", "/pages/task", _params, nil, _settings ->
        {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

      "GET", "/comments", _params, nil, _settings ->
        {:ok, %{"results" => [], "has_more" => "yes"}}
    end

    assert AgentTool.execute(
             "notion_task_comments",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: malformed
           )["output"] =~ "notion_malformed_provider_response"

    missing_cursor = fn
      "GET", "/pages/task", _params, nil, _settings ->
        {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

      "GET", "/comments", _params, nil, _settings ->
        {:ok, %{"results" => [], "has_more" => true}}
    end

    assert AgentTool.execute(
             "notion_task_comments",
             %{},
             tracker_settings: notion_settings(),
             tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
             notion_request: missing_cursor
           )["output"] =~ "notion_pagination_integrity_failure"
  end

  defp notion_settings, do: %{token: "token", database_id: "database", terminal_states: ["Done"]}
end
