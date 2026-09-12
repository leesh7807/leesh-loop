defmodule SymphonyElixir.Notion.AdapterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.AgentTool
  alias SymphonyElixir.Notion.Adapter
  alias SymphonyElixir.Notion.Client

  test "adapter validates settings and preserves its public integration boundary" do
    settings = %{
      token: "token",
      database_id: "database",
      active_states: ["Ready", "Rework"],
      terminal_states: ["Done", "Cancelled"]
    }

    assert :ok = Adapter.validate_config(settings)
    assert {:error, :missing_notion_active_states} = Adapter.validate_config(%{settings | active_states: nil})
    assert {:ok, []} = Adapter.fetch_issues_by_states([])
    assert {:ok, []} = Adapter.fetch_issues_by_ids([])
    assert [%{"name" => "notion_task_set_state"}] = Enum.filter(Adapter.agent_tool_specs(), &(&1["name"] == "notion_task_set_state"))

    assert Adapter.secret_environment_names(%{secret_environment_names: ["CUSTOM_TOKEN"]}) == ["CUSTOM_TOKEN"]
    assert Adapter.secret_environment_names(%{provider: %{"token" => "$CUSTOM_TOKEN"}}) == ["NOTION_TOKEN", "CUSTOM_TOKEN"]
    assert {:error, :invalid_notion_tracker_configuration} = Adapter.bind_session(%{tracker_settings: %{}}, %Issue{id: "task"})
    assert Adapter.bind_session(%{tracker_settings: settings}, nil) == %{tracker_settings: settings}

    response = Adapter.execute_agent_tool("unsupported", %{}, tracker_settings: settings)
    refute response["success"]
  end

  test "reads rich-text states and queries exact provider-native values" do
    settings = notion_settings()

    request = fn method, path, _params, body, _settings ->
      case {method, path} do
        {"GET", "/databases/database"} ->
          {:ok, %{"data_sources" => [%{"id" => "source"}]}}

        {"GET", "/data_sources/source"} ->
          {:ok, %{"properties" => canonical_properties()}}

        {"POST", "/data_sources/source/query"} ->
          assert body == %{
                   "page_size" => 100,
                   "filter" => %{
                     "or" => [
                       %{"property" => "State", "rich_text" => %{"equals" => "Ready"}},
                       %{"property" => "State", "rich_text" => %{"equals" => "Rework"}}
                     ]
                   }
                 }

          {:ok, %{"results" => [task_page("Rework")], "has_more" => false}}

        {"GET", "/blocks/task/children"} ->
          {:ok,
           %{
             "results" => [
               %{"id" => "plan", "type" => "child_page", "child_page" => %{"title" => "Plan"}},
               %{"id" => "workpad", "type" => "child_page", "child_page" => %{"title" => "Workpad"}}
             ],
             "has_more" => false
           }}

        {"GET", "/blocks/plan/children"} ->
          {:ok,
           %{
             "results" => [
               %{
                 "type" => "paragraph",
                 "paragraph" => %{"rich_text" => [%{"plain_text" => "# Plan\naccepted"}]}
               }
             ],
             "has_more" => false
           }}
      end
    end

    assert {:ok, [issue]} = Client.fetch_issues_by_states_for_test(["Ready", "Rework"], settings, request)
    assert issue.state == "Rework"
    assert issue.description == "# Plan\naccepted"
  end

  test "select State surfaces are incompatible and are not migrated" do
    settings = notion_settings()

    request = fn
      "GET", "/databases/database", _params, _body, _settings ->
        {:ok, %{"data_sources" => [%{"id" => "source"}]}}

      "GET", "/data_sources/source", _params, _body, _settings ->
        {:ok, %{"properties" => canonical_properties("select")}}

      _method, _path, _params, _body, _settings ->
        flunk("incompatible schema must fail before querying or mutating tasks")
    end

    assert {:error, :notion_incompatible_task_data_source} =
             Client.fetch_issues_by_states_for_test(["Ready"], settings, request)
  end

  test "worker state mutation writes exact rich-text strings" do
    settings = notion_settings()

    response =
      AgentTool.execute(
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

  defp notion_settings do
    %{token: "token", database_id: "database", terminal_states: ["Done", "Cancelled"]}
  end

  defp canonical_properties(state_type \\ "rich_text") do
    %{
      "Identifier" => %{"type" => "rich_text"},
      "Title" => %{"type" => "title"},
      "State" => %{"type" => state_type},
      "Priority" => %{"type" => "number"},
      "Labels" => %{"type" => "multi_select"},
      "Blocked By" => %{"type" => "relation"}
    }
  end

  defp task_page(state) do
    %{
      "id" => "task",
      "parent" => %{"type" => "data_source_id", "data_source_id" => "source"},
      "properties" => %{
        "Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "PLAN-1"}]},
        "Title" => %{"type" => "title", "title" => [%{"plain_text" => "Task"}]},
        "State" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => state}]},
        "Priority" => %{"type" => "number", "number" => 3},
        "Labels" => %{"type" => "multi_select", "multi_select" => []},
        "Blocked By" => %{"type" => "relation", "relation" => []}
      }
    }
  end
end
