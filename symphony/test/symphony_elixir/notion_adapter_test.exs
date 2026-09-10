defmodule SymphonyElixir.Notion.AdapterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.Notion.{Adapter, AgentTool, Client}

  test "Publisher task becomes a mechanical Tracker.Issue and excludes Workpad" do
    assert {:ok, [issue]} = Client.fetch_issues_by_states_for_test(["Ready"], settings(), responder())
    assert issue.id == "page-1"
    assert issue.identifier == "PLAN-ABC123"
    assert issue.title == "Publisher task"
    assert issue.description == "# Plan\nShip the adapter."
    refute issue.description =~ "runtime output"
    assert issue.state == "Ready"
    assert issue.priority == 3
    assert issue.labels == ["backend", "urgent"]
    assert issue.blocked_by == [%{"id" => "page-blocker"}]
    assert issue.url == "https://www.notion.so/page-1"
    assert issue.native_ref == %{"page_id" => "page-1", "data_source_id" => "source-1"}
    assert issue.dispatchable
    assert %DateTime{} = issue.created_at
    assert %DateTime{} = issue.updated_at
  end

  test "state reads and block reads paginate completely" do
    assert {:ok, issues} = Client.fetch_issues_by_states_for_test(["Ready"], settings(), paged_responder())
    assert Enum.map(issues, & &1.id) == ["page-1", "page-2"]
    assert Enum.map(issues, & &1.description) == ["first", "second"]
  end

  test "refresh uses page id, preserves missing-record semantics, and rejects provider failures" do
    assert {:ok, [issue]} = Client.fetch_issues_by_ids_for_test(["page-1", "missing"], settings(), responder())
    assert issue.id == "page-1"
    assert {:error, {:notion_api_status, 401}} = Client.fetch_issues_by_states_for_test(["Ready"], settings(), fn _m, _p, _q, _b, _s -> {:ok, %{status: 401, body: %{}}} end)
  end

  test "incompatible Publisher schema is not repaired or reinterpreted" do
    assert {:error, :notion_incompatible_schema} = Client.fetch_issues_by_states_for_test(["Ready"], settings(), fn m, p, q, b, s ->
      case responder().(m, p, q, b, s) do
        {:ok, %{status: 200, body: %{"properties" => properties} = body}} -> {:ok, %{status: 200, body: %{body | "properties" => Map.put(properties, "State", %{"type" => "status"})}}}
        response -> response
      end
    end)
  end

  test "adapter is registered, validates connection settings, and deliberately exposes no mutation tools" do
    assert :ok = Adapter.validate_config(settings())
    assert {:error, :missing_notion_database_id} = Adapter.validate_config(%{provider: %{"token" => "token"}})
    assert AgentTool.tool_specs() == []
    refute AgentTool.execute("notion_update_page", %{}, [])["success"]
  end

  defp settings, do: %{provider: %{"token" => "token", "database_id" => "database-1"}}

  defp responder do
    fn method, path, _query, body, _settings ->
      case {method, path} do
        {"GET", "/databases/database-1"} -> ok(%{"data_sources" => [%{"id" => "source-1"}]})
        {"GET", "/data_sources/source-1"} -> ok(schema())
        {"POST", "/data_sources/source-1/query"} ->
          assert get_in(body, ["filter", "property"]) == "State"
          ok(%{"results" => [page("page-1")], "has_more" => false})
        {"GET", "/pages/page-1"} -> ok(page("page-1"))
        {"GET", "/pages/missing"} -> {:ok, %{status: 404, body: %{}}}
        {"GET", "/blocks/page-1/children"} -> ok(%{"results" => blocks("# Plan", "Ship the adapter.", "runtime output"), "has_more" => false})
      end
    end
  end

  defp paged_responder do
    fn method, path, query, body, _settings ->
      cursor = (body || %{})["start_cursor"] || query["start_cursor"]

      case {method, path, cursor} do
        {"GET", "/databases/database-1", _} -> ok(%{"data_sources" => [%{"id" => "source-1"}]})
        {"GET", "/data_sources/source-1", _} -> ok(schema())
        {"POST", "/data_sources/source-1/query", nil} -> ok(%{"results" => [page("page-1")], "has_more" => true, "next_cursor" => "next"})
        {"POST", "/data_sources/source-1/query", "next"} -> ok(%{"results" => [page("page-2")], "has_more" => false})
        {"GET", "/blocks/page-1/children", nil} -> ok(%{"results" => blocks("first", nil, nil), "has_more" => true, "next_cursor" => "blocks-next"})
        {"GET", "/blocks/page-1/children", "blocks-next"} -> ok(%{"results" => [%{"type" => "heading_1", "heading_1" => %{"rich_text" => [%{"plain_text" => "Workpad"}]}}], "has_more" => false})
        {"GET", "/blocks/page-2/children", _} -> ok(%{"results" => blocks("second", nil, nil), "has_more" => false})
      end
    end
  end

  defp schema do
    %{"properties" => %{"Identifier" => %{"type" => "rich_text"}, "Title" => %{"type" => "title"}, "State" => %{"type" => "select"}, "Priority" => %{"type" => "number"}, "Labels" => %{"type" => "multi_select"}, "Description" => %{"type" => "rich_text"}, "Plan Source" => %{"type" => "url"}, "Blocked By" => %{"type" => "relation", "relation" => %{"data_source_id" => "source-1", "single_property" => %{}}}}}
  end

  defp page(id) do
    %{"id" => id, "url" => "https://www.notion.so/#{id}", "created_time" => "2026-09-10T01:02:03.000Z", "last_edited_time" => "2026-09-10T04:05:06.000Z", "properties" => %{"Identifier" => %{"type" => "rich_text", "rich_text" => [%{"plain_text" => "PLAN-ABC123"}]}, "Title" => %{"type" => "title", "title" => [%{"plain_text" => "Publisher task"}]}, "State" => %{"type" => "select", "select" => %{"name" => "Ready"}}, "Priority" => %{"type" => "number", "number" => 3}, "Labels" => %{"type" => "multi_select", "multi_select" => [%{"name" => "backend"}, %{"name" => "urgent"}]}, "Blocked By" => %{"type" => "relation", "relation" => [%{"id" => "page-blocker"}]}}}
  end

  defp blocks(plan, extra, workpad) do
    [%{"type" => "heading_1", "heading_1" => %{"rich_text" => [%{"plain_text" => "Plan"}]}}, %{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"plain_text" => plan}]}}, maybe_paragraph(extra), %{"type" => "heading_1", "heading_1" => %{"rich_text" => [%{"plain_text" => "Workpad"}]}}, maybe_paragraph(workpad)] |> Enum.reject(&is_nil/1)
  end
  defp maybe_paragraph(nil), do: nil
  defp maybe_paragraph(text), do: %{"type" => "paragraph", "paragraph" => %{"rich_text" => [%{"plain_text" => text}]}}
  defp ok(body), do: {:ok, %{status: 200, body: body}}
end
