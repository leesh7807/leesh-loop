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

  test "rich-text chunking preserves exact text without transport paragraph boundaries" do
    exact_boundary = String.duplicate("a", 2_000)
    assert append_body(exact_boundary)["children"] |> length() == 1

    exact_items = rich_text_items(append_body(exact_boundary))
    assert exact_items |> Enum.map(&get_in(&1, ["text", "content"])) == [exact_boundary]
    refute Enum.any?(exact_items, &(get_in(&1, ["text", "content"]) == ""))

    single_line = String.duplicate("b", 2_001)
    single_line_body = append_body(single_line)
    assert length(single_line_body["children"]) == 1
    assert single_line_body |> rich_text_items() |> Enum.map_join("", &get_in(&1, ["text", "content"])) == single_line

    unicode = String.duplicate("🙂", 1_999) <> "한" <> "終"
    unicode_body = append_body(unicode)
    unicode_items = rich_text_items(unicode_body)
    assert length(unicode_body["children"]) == 1
    assert Enum.map_join(unicode_items, "", &get_in(&1, ["text", "content"])) == unicode
    assert Enum.all?(unicode_items, &(String.length(get_in(&1, ["text", "content"])) <= 2_000))
  end

  test "paragraphs split only when the rich-text representation limit requires it" do
    text = String.duplicate("c", 2_000 * 100 + 1)
    body = append_body(text)

    assert Enum.map(body["children"], &length(get_in(&1, ["paragraph", "rich_text"]))) == [100, 1]
    assert body |> rich_text_items() |> Enum.map_join("", &get_in(&1, ["text", "content"])) == text
  end

  test "request batches preserve order and stay within provider limits" do
    text = String.duplicate("d", 600_001)
    response = append_response(text, append_recorder(self()))
    bodies = collect_append_bodies()

    assert response["success"]
    assert length(bodies) > 1
    assert Enum.all?(bodies, &(length(&1["children"]) <= 100))
    assert Enum.all?(bodies, &(byte_size(Jason.encode!(&1)) <= 500_000))
    assert bodies |> Enum.flat_map(&rich_text_items/1) |> Enum.map_join("", &get_in(&1, ["text", "content"])) == text

    result = Jason.decode!(response["output"])
    assert result["outcome"] == "complete"
    assert result["acknowledged_batch_count"] == length(bodies)
    assert result["total_batch_count"] == length(bodies)
  end

  test "a first batch failure is not reported as a successful append" do
    text = String.duplicate("e", 600_001)

    response =
      append_response(text, fn
        "GET", "/pages/task", _params, nil, _settings ->
          scope_response()

        "PATCH", "/blocks/task/children", _params, body, _settings ->
          send(self(), {:workpad_attempt, body})
          {:error, :notion_rate_limited}
      end)

    assert response["success"] == false
    assert_receive {:workpad_attempt, _body}
    refute_receive {:workpad_attempt, _body}, 20

    error = Jason.decode!(response["output"])["error"]
    assert error["outcome"] == "failed_before_acknowledgement"
    assert error["acknowledged_batch_count"] == 0
    assert error["total_batch_count"] > 1
    assert error["provider_error"] =~ "notion_rate_limited"
  end

  test "a later known failure stops subsequent batches and reports acknowledged progress" do
    text = String.duplicate("f", 1_000_001)
    counter = :counters.new(1, [])

    response =
      append_response(text, fn
        "GET", "/pages/task", _params, nil, _settings ->
          scope_response()

        "PATCH", "/blocks/task/children", _params, body, _settings ->
          :counters.add(counter, 1, 1)
          attempt = :counters.get(counter, 1)
          send(self(), {:workpad_attempt, attempt, body})
          if attempt == 2, do: {:error, :notion_rate_limited}, else: {:ok, %{"id" => attempt}}
      end)

    assert response["success"] == false
    assert_received {:workpad_attempt, 1, _first_body}
    assert_received {:workpad_attempt, 2, _second_body}
    refute_received {:workpad_attempt, 3, _body}

    error = Jason.decode!(response["output"])["error"]
    assert error["outcome"] == "partial_append"
    assert error["acknowledged_batch_count"] == 1
    assert error["total_batch_count"] > 2
    assert error["provider_error"] =~ "notion_rate_limited"
  end

  test "transport failures preserve ambiguity instead of claiming an exact durable prefix" do
    text = String.duplicate("g", 1_000_001)
    counter = :counters.new(1, [])

    response =
      append_response(text, fn
        "GET", "/pages/task", _params, nil, _settings ->
          scope_response()

        "PATCH", "/blocks/task/children", _params, body, _settings ->
          :counters.add(counter, 1, 1)
          attempt = :counters.get(counter, 1)
          send(self(), {:workpad_attempt, attempt, body})
          if attempt == 2, do: {:error, {:notion_transport_failure, :timeout}}, else: {:ok, %{"id" => attempt}}
      end)

    assert response["success"] == false
    assert_received {:workpad_attempt, 1, _first_body}
    assert_received {:workpad_attempt, 2, _second_body}
    refute_received {:workpad_attempt, 3, _body}

    error = Jason.decode!(response["output"])["error"]
    assert error["outcome"] == "ambiguous_provider_outcome"
    assert error["acknowledged_batch_count"] == 1
    assert error["failed_batch_durable_effect"] == "unknown"
    assert error["retry_suffix"] == "unknown"
    assert error["provider_error"] =~ "notion_transport_failure"
  end

  test "out-of-scope workpad append fails before mutation" do
    response =
      AgentTool.execute(
        "notion_task_append_workpad",
        %{"text" => String.duplicate("h", 2_001)},
        tracker_settings: notion_settings(),
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
        notion_request: fn
          "GET", "/pages/task", _params, nil, _settings ->
            {:ok, %{"parent" => %{"type" => "page_id", "page_id" => "other"}}}

          "PATCH", _path, _params, _body, _settings ->
            flunk("out-of-scope append must not mutate Notion")
        end
      )

    assert response["success"] == false
    assert response["output"] =~ "notion_out_of_scope_task"
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

  defp append_body(text) do
    response = append_response(text, append_recorder(self()))
    assert response["success"]
    assert_receive {:workpad_append, body}
    refute_receive {:workpad_append, _body}, 20
    body
  end

  defp append_response(text, request) do
    AgentTool.execute(
      "notion_task_append_workpad",
      %{"text" => text},
      tracker_settings: notion_settings(),
      tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
      notion_request: request
    )
  end

  defp append_recorder(test_pid) do
    fn
      "GET", "/pages/task", _params, nil, _settings ->
        scope_response()

      "PATCH", "/blocks/task/children", _params, body, _settings ->
        send(test_pid, {:workpad_append, body})
        {:ok, %{"id" => "append"}}
    end
  end

  defp scope_response do
    {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}
  end

  defp collect_append_bodies do
    receive do
      {:workpad_append, body} -> [body | collect_append_bodies()]
    after
      0 -> []
    end
  end

  defp rich_text_items(body), do: Enum.flat_map(body["children"], &get_in(&1, ["paragraph", "rich_text"]))
end
