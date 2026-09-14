defmodule SymphonyElixir.Notion.AdapterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.{Adapter, Client}
  alias SymphonyElixir.Tracker.Issue

  test "adapter validates settings and preserves its public integration boundary" do
    settings = %{
      token: "token",
      database_id: "database",
      active_states: ["Ready", "Rework"],
      terminal_states: ["Done", "Cancelled"]
    }

    assert :ok = Adapter.validate_config(settings)

    assert {:error, :missing_notion_active_states} =
             Adapter.validate_config(%{settings | active_states: nil})

    assert {:ok, []} = Adapter.fetch_issues_by_states([])
    assert {:ok, []} = Adapter.fetch_issues_by_ids([])

    assert [%{"name" => "notion_task_set_state"}] =
             Enum.filter(Adapter.agent_tool_specs(), &(&1["name"] == "notion_task_set_state"))

    assert [%{"name" => "notion_task_append_workpad"}] =
             Enum.filter(Adapter.agent_tool_specs(), &(&1["name"] == "notion_task_append_workpad"))

    assert Adapter.secret_environment_names(%{secret_environment_names: ["CUSTOM_TOKEN"]}) == ["CUSTOM_TOKEN"]

    assert Adapter.secret_environment_names(%{provider: %{"token" => "$CUSTOM_TOKEN"}}) ==
             ["NOTION_TOKEN", "CUSTOM_TOKEN"]

    assert {:error, :invalid_notion_tracker_configuration} =
             Adapter.bind_session(%{tracker_settings: %{}}, %Issue{id: "task"})

    assert Adapter.bind_session(%{tracker_settings: settings}, nil) == %{tracker_settings: settings}
    refute Adapter.execute_agent_tool("unsupported", %{}, tracker_settings: settings)["success"]
  end

  test "normalization follows the explicit Plan relation and ignores task body content" do
    request = recording_request(self(), task: task_page("Rework"))

    assert {:ok, [issue]} =
             Client.fetch_issues_by_states_for_test(["Ready", "Rework"], notion_settings(), request)

    assert issue.identifier == "PLAN-1"
    assert issue.state == "Rework"
    assert issue.description == "# Plan\naccepted"
    refute_received {:notion_request, "GET", "/blocks/task/children", _, _, _}
    assert_received {:notion_request, "GET", "/blocks/plan/children", _, _, _}
  end

  test "Plan source is selected by relation target, not by display name or order" do
    request =
      recording_request(self(),
        data_sources: ["plan-source", "source"],
        source_names: %{"plan-source" => "Tasks", "source" => "Not Plans"}
      )

    assert {:ok, [issue]} = Client.fetch_issues_by_ids_for_test(["task"], notion_settings(), request)
    assert issue.description == "# Plan\naccepted"
  end

  test "missing, empty, multiple, out-of-scope, mismatched, unreadable, and empty Plans are malformed" do
    cases = [
      {"missing Plan", &Map.update!(&1, "properties", fn props -> Map.delete(props, "Plan") end), [], nil, :invalid_plan_relation},
      {"malformed Plan property", &put_in(&1["properties"]["Plan"], %{"type" => "rich_text", "rich_text" => []}), [], nil, :invalid_plan_relation},
      {"empty relation", &put_in(&1["properties"]["Plan"]["relation"], []), [], nil, :invalid_plan_relation},
      {"multiple relations", &put_in(&1["properties"]["Plan"]["relation"], [%{"id" => "plan"}, %{"id" => "plan-2"}]), [], nil, :invalid_plan_relation},
      {"wrong source", & &1, [parent: "another-source"], nil, :out_of_scope_plan},
      {"wrong identifier", & &1, [identifier: "PLAN-OTHER"], nil, :plan_identifier_mismatch},
      {"empty Plan body", & &1, [], "", :empty_plan}
    ]

    for {name, mutate_task, plan_opts, plan_content, expected} <- cases do
      request =
        recording_request(self(),
          task: mutate_task.(task_page()),
          plan: plan_page(plan_opts),
          plan_content: plan_content
        )

      assert {:error, {:notion_malformed_task_representation, "task", ^expected}} =
               Client.fetch_issues_by_ids_for_test(["task"], notion_settings(), request),
             name
    end
  end

  test "an unreadable Plan page fails normalization instead of falling back to task body" do
    request = recording_request(self(), plan_response: {:error, :notion_not_found})

    assert {:error, {:notion_malformed_task_representation, "task", :notion_not_found}} =
             Client.fetch_issues_by_ids_for_test(["task"], notion_settings(), request)
  end

  test "cross-binding to another valid Plan is rejected" do
    task = put_in(task_page()["properties"]["Plan"]["relation"], [%{"id" => "plan-b"}])

    request =
      recording_request(self(),
        task: task,
        plan_id: "plan-b",
        plan: plan_page(identifier: "PLAN-B")
      )

    assert {:error, {:notion_malformed_task_representation, "task", :plan_identifier_mismatch}} =
             Client.fetch_issues_by_ids_for_test(["task"], notion_settings(), request)
  end

  test "legacy child pages are not a Plan fallback" do
    task = task_page() |> update_in(["properties"], &Map.delete(&1, "Plan"))

    request =
      recording_request(self(),
        task: task,
        task_children: [%{"id" => "legacy-plan", "type" => "child_page", "child_page" => %{"title" => "Plan"}}]
      )

    assert {:error, {:notion_malformed_task_representation, "task", :invalid_plan_relation}} =
             Client.fetch_issues_by_ids_for_test(["task"], notion_settings(), request)

    refute_received {:notion_request, "GET", "/blocks/task/children", _, _, _}
  end

  test "multiple task-compatible sources fail deterministically" do
    request = recording_request(self(), data_sources: ["source", "source-2"], extra_task_source: true)

    assert {:error, :notion_ambiguous_task_data_source} =
             Client.fetch_issues_by_states_for_test(["Ready"], notion_settings(), request)
  end

  test "multiple Plan-compatible sources fail deterministically" do
    request = recording_request(self(), data_sources: ["source", "plan-source", "plan-2"], extra_plan_source: true)

    assert {:error, :notion_ambiguous_plan_data_source} =
             Client.fetch_issues_by_states_for_test(["Ready"], notion_settings(), request)
  end

  test "worker state mutation writes exact rich-text strings" do
    settings = notion_settings()

    response =
      Adapter.execute_agent_tool(
        "notion_task_set_state",
        %{"state" => "Human Review"},
        tracker_settings: settings,
        tracker_binding: %{notion_data_source_id: "source", notion_issue_id: "task"},
        notion_request: fn
          "GET", "/pages/task", _params, nil, _settings ->
            {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => "source"}}}

          "PATCH", "/pages/task", _params, body, _settings ->
            send(self(), {:state_patch, body})
            {:ok, %{"id" => "task"}}
        end
      )

    assert response["success"]

    assert_receive {:state_patch,
                    %{
                      "properties" => %{
                        "State" => %{
                          "rich_text" => [%{"type" => "text", "text" => %{"content" => "Human Review"}}]
                        }
                      }
                    }}
  end

  defp notion_settings, do: %{token: "token", database_id: "database", terminal_states: ["Done", "Cancelled"]}

  defp canonical_properties(source_id \\ "source") do
    %{
      "Identifier" => %{"type" => "rich_text"},
      "Title" => %{"type" => "title"},
      "State" => %{"type" => "rich_text"},
      "Priority" => %{"type" => "number"},
      "Labels" => %{"type" => "multi_select"},
      "Blocked By" => %{"type" => "relation", "relation" => %{"data_source_id" => source_id}},
      "Plan" => %{"type" => "relation", "relation" => %{"data_source_id" => "plan-source"}}
    }
  end

  defp plan_properties, do: %{"Identifier" => %{"type" => "rich_text"}, "Title" => %{"type" => "title"}}

  defp task_page(state \\ "Ready") do
    %{
      "id" => "task",
      "parent" => %{"type" => "data_source_id", "data_source_id" => "source"},
      "properties" => %{
        "Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "PLAN-1"}]},
        "Title" => %{"type" => "title", "title" => [%{"plain_text" => "Task"}]},
        "State" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => state}]},
        "Priority" => %{"type" => "number", "number" => 3},
        "Labels" => %{"type" => "multi_select", "multi_select" => []},
        "Blocked By" => %{"type" => "relation", "relation" => []},
        "Plan" => %{"type" => "relation", "relation" => [%{"id" => "plan"}]}
      }
    }
  end

  defp plan_page(opts) do
    identifier = Keyword.get(opts, :identifier, "PLAN-1")
    parent = Keyword.get(opts, :parent, "plan-source")

    %{
      "id" => Keyword.get(opts, :id, "plan"),
      "parent" => %{"type" => "data_source_id", "data_source_id" => parent},
      "is_locked" => Keyword.get(opts, :locked, true),
      "properties" => %{
        "Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => identifier}]},
        "Title" => %{"type" => "title", "title" => [%{"plain_text" => "Task"}]}
      }
    }
  end

  defp recording_request(test_pid, opts) do
    plan_id = Keyword.get(opts, :plan_id, "plan")
    plan = Keyword.get(opts, :plan, plan_page(id: plan_id))
    plan_content = Keyword.get(opts, :plan_content, "# Plan\naccepted") || "# Plan\naccepted"

    state = %{
      task: Keyword.get(opts, :task, task_page()),
      plan_id: plan_id,
      plan_path: "/pages/#{plan_id}",
      data_sources: Keyword.get(opts, :data_sources, ["source", "plan-source"]),
      extra_task_source: Keyword.get(opts, :extra_task_source, false),
      task_schema: canonical_properties(),
      source_names: Keyword.get(opts, :source_names, %{}),
      task_children: Keyword.get(opts, :task_children, []),
      plan_content: plan_content,
      plan_response: Keyword.get(opts, :plan_response, {:ok, plan})
    }

    fn method, path, params, body, settings ->
      send(test_pid, {:notion_request, method, path, params, body, settings})
      recording_response(method, path, state)
    end
  end

  defp recording_response("GET", path, %{plan_path: plan_path, plan_response: response})
       when path == plan_path,
       do: response

  defp recording_response("GET", path, %{plan_id: plan_id, plan_content: content})
       when path == "/blocks/" <> plan_id <> "/children" do
    {:ok, %{"results" => plan_blocks(content), "has_more" => false}}
  end

  defp recording_response("GET", "/databases/database", %{
         data_sources: data_sources,
         source_names: names
       }) do
    entries = Enum.map(data_sources, &%{"id" => &1, "name" => names[&1] || &1})
    {:ok, %{"data_sources" => entries}}
  end

  defp recording_response("GET", "/data_sources/source", %{task_schema: schema}),
    do: {:ok, %{"properties" => schema}}

  defp recording_response("GET", "/data_sources/source-2", %{extra_task_source: extra}),
    do: {:ok, %{"properties" => task_source_schema(extra)}}

  defp recording_response("GET", path, _state)
       when path in ["/data_sources/plan-source", "/data_sources/plan-2"],
       do: {:ok, %{"properties" => plan_properties()}}

  defp recording_response("POST", "/data_sources/source/query", %{task: task}),
    do: {:ok, %{"results" => [task], "has_more" => false}}

  defp recording_response("GET", "/pages/task", %{task: task}), do: {:ok, task}

  defp recording_response("GET", "/blocks/task/children", %{task_children: children}),
    do: {:ok, %{"results" => children, "has_more" => false}}

  defp plan_blocks(""), do: []

  defp plan_blocks(content) do
    [%{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"plain_text" => content}]}}]
  end

  defp task_source_schema(true), do: canonical_properties("source-2")
  defp task_source_schema(false), do: canonical_properties()
end
