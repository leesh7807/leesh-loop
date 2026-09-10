defmodule SymphonyElixir.Notion.AdapterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.{Adapter, AgentTool, Client}

  @database "053a3243-bd88-4f0f-bf34-abbff6fccf2a"

  test "normalizes the Publisher surface without interpreting state or dependencies" do
    assert {:ok, issue} = Client.normalize_issue_for_test(page("page-1"), plan_blocks())
    assert issue.id == "page-1"
    assert issue.native_ref == %{"page_id" => "page-1"}
    assert issue.identifier == "PLAN-123"
    assert issue.title == "Publish adapter"
    assert issue.state == "Ready"
    assert issue.priority == 3
    assert issue.labels == ["symphony", "notion"]
    assert issue.blocked_by == [%{"id" => "page-0"}]
    assert issue.description == "Implement the translation boundary."
    refute issue.description =~ "runtime note"
    assert issue.url == "https://www.notion.so/page-1"
    assert %DateTime{} = issue.created_at
    assert %DateTime{} = issue.updated_at
    assert issue.dispatchable
  end

  test "state fetch pages completely and schema/provider failures remain errors" do
    request = fn
      "GET", "/databases/#{@database}", _, nil, _ -> {:ok, %{status: 200, body: schema()}}
      "POST", "/databases/#{@database}/query", _, %{"start_cursor" => "next"}, _ -> {:ok, %{status: 200, body: %{"results" => [page("page-2")], "has_more" => false}}}
      "POST", "/databases/#{@database}/query", _, _, _ -> {:ok, %{status: 200, body: %{"results" => [page("page-1")], "has_more" => true, "next_cursor" => "next"}}}
      "GET", "/blocks/page-1/children", _, nil, _ -> {:ok, %{status: 200, body: %{"results" => plan_blocks(), "has_more" => false}}}
      "GET", "/blocks/page-2/children", _, nil, _ -> {:ok, %{status: 200, body: %{"results" => plan_blocks(), "has_more" => false}}}
      "GET", "/pages/page-0", _, nil, _ -> {:ok, %{status: 200, body: blocker_page()}}
    end

    assert {:ok, issues} = Client.fetch_issues_by_states_for_test(["Ready"], settings(), request)
    assert Enum.map(issues, & &1.id) == ["page-1", "page-2"]

    assert {:error, {:notion_api_status, 401}} =
             Client.fetch_issues_by_states_for_test(["Ready"], settings(), fn _, _, _, _, _ -> {:ok, %{status: 401, body: %{}}} end)

    assert {:error, {:notion_incompatible_schema, "State"}} =
             Client.fetch_issues_by_states_for_test(["Ready"], settings(), fn _, _, _, _, _ ->
               invalid_schema = Map.put(schema(), "properties", Map.delete(schema()["properties"], "State"))
               {:ok, %{status: 200, body: invalid_schema}}
             end)
  end

  test "ID refresh uses page identities and tools only expose represented page operations" do
    request = fn
      "GET", "/databases/#{@database}", _, nil, _ -> {:ok, %{status: 200, body: schema()}}
      "GET", "/pages/page-1", _, nil, _ -> {:ok, %{status: 200, body: page("page-1")}}
      "GET", "/pages/missing", _, nil, _ -> {:ok, %{status: 404, body: %{}}}
      "GET", "/blocks/page-1/children", _, nil, _ -> {:ok, %{status: 200, body: %{"results" => plan_blocks(), "has_more" => false}}}
      "GET", "/pages/page-0", _, nil, _ -> {:ok, %{status: 200, body: blocker_page()}}
    end

    assert {:ok, [issue]} = Client.fetch_issues_by_ids_for_test(["page-1", "missing"], settings(), request)
    assert issue.id == "page-1"
    assert Enum.map(AgentTool.tool_specs(), & &1["name"]) == ["notion_read_page", "notion_read_comments", "notion_update_page", "notion_append_blocks"]
    refute Enum.any?(AgentTool.tool_specs(), &String.contains?(&1["name"], "complete"))
    assert Adapter.validate_config(settings()) == :ok
  end

  defp settings(provider \\ %{}) do
    %{
      kind: "notion",
      active_states: ["Ready"],
      terminal_states: ["Done"],
      provider: Map.merge(%{"database_url" => "https://app.notion.com/p/studyleesh/053a3243bd884f0fbf34abbff6fccf2a", "token" => "token"}, provider)
    }
  end

  defp schema do
    %{
      "properties" => %{
        "Identifier" => %{"type" => "rich_text"},
        "Title" => %{"type" => "title"},
        "State" => %{"type" => "select"},
        "Priority" => %{"type" => "number"},
        "Labels" => %{"type" => "multi_select"},
        "Blocked By" => %{"type" => "relation"},
        "Description" => %{"type" => "rich_text"}
      }
    }
  end

  defp page(id) do
    %{
      "id" => id,
      "url" => "https://www.notion.so/#{id}",
      "created_time" => "2026-09-10T01:02:03.000Z",
      "last_edited_time" => "2026-09-10T02:03:04.000Z",
      "properties" => %{
        "Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "PLAN-123"}]},
        "Title" => %{"type" => "title", "title" => [%{"plain_text" => "Publish adapter"}]},
        "State" => %{"type" => "select", "select" => %{"name" => "Ready"}},
        "Priority" => %{"type" => "number", "number" => 3},
        "Labels" => %{"type" => "multi_select", "multi_select" => [%{"name" => "symphony"}, %{"name" => "notion"}]},
        "Blocked By" => %{"type" => "relation", "relation" => [%{"id" => "page-0"}]},
        "Description" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "Publisher metadata"}]}
      }
    }
  end

  defp blocker_page, do: %{"properties" => %{"State" => %{"type" => "select", "select" => %{"name" => "In Progress"}}}}

  defp plan_blocks do
    [
      %{"type" => "heading_1", "heading_1" => %{"rich_text" => [%{"plain_text" => "Plan"}]}},
      %{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"plain_text" => "Implement the translation boundary."}]}},
      %{"type" => "heading_1", "heading_1" => %{"rich_text" => [%{"plain_text" => "Workpad"}]}},
      %{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"plain_text" => "runtime note"}]}}
    ]
  end
end
