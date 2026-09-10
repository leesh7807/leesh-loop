defmodule SymphonyElixir.Notion.Client do
  @moduledoc """Notion transport and mechanical Publisher-surface normalization."""

  alias SymphonyElixir.Config
  alias SymphonyElixir.Tracker.Issue

  @endpoint "https://api.notion.com/v1"
  @version "2025-09-03"
  @page_size 100
  @properties %{"Identifier" => "rich_text", "Title" => "title", "State" => "select", "Priority" => "number", "Labels" => "multi_select", "Blocked By" => "relation", "Description" => "rich_text", "Plan Source" => "url"}

  @spec validate_settings(map()) :: :ok | {:error, term()}
  def validate_settings(tracker), do: with({:ok, _} <- settings(tracker), do: :ok)

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(tracker) do
    provider = provider(tracker)
    Enum.uniq(["NOTION_TOKEN" | env_names([provider["token"]])])
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: fetch_issues_by_states(states, Config.settings!().tracker, &request/5)

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids), do: fetch_issues_by_ids(ids, Config.settings!().tracker, &request/5)

  @spec request(String.t(), String.t(), map(), term(), keyword()) :: {:ok, %{status: integer(), body: term()}} | {:error, term()}
  def request(method, path, query, body, opts \\ []) do
    tracker = Keyword.get_lazy(opts, :tracker_settings, fn -> Config.settings!().tracker end)
    with {:ok, settings} <- settings(tracker), do: perform_request(method, path, query, body, settings)
  end

  @doc false
  @spec fetch_issues_by_states_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states_for_test(states, tracker, fun), do: fetch_issues_by_states(states, tracker, fun)

  @doc false
  @spec fetch_issues_by_ids_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids_for_test(ids, tracker, fun), do: fetch_issues_by_ids(ids, tracker, fun)

  defp fetch_issues_by_states([], _tracker, _fun), do: {:ok, []}
  defp fetch_issues_by_states(states, tracker, fun) do
    with {:ok, s} <- settings(tracker), {:ok, s} <- surface(s, fun) do
      states |> Enum.uniq() |> Enum.reduce_while({:ok, []}, fn state, {:ok, acc} ->
        case query_pages(s, %{"property" => "State", "select" => %{"equals" => state}}, fun, nil, []) do
          {:ok, pages} -> {:cont, {:ok, acc ++ pages}}
          error -> {:halt, error}
        end
      end) |> normalize_pages(s, fun)
    end
  end

  defp fetch_issues_by_ids([], _tracker, _fun), do: {:ok, []}
  defp fetch_issues_by_ids(ids, tracker, fun) do
    with {:ok, s} <- settings(tracker), {:ok, s} <- surface(s, fun) do
      ids |> Enum.uniq() |> Enum.reduce_while({:ok, []}, fn id, {:ok, acc} ->
        case api("GET", "/pages/#{URI.encode(id)}", %{}, nil, s, fun, true) do
          {:ok, :not_found} -> {:cont, {:ok, acc}}
          {:ok, page} when is_map(page) -> {:cont, {:ok, [page | acc]}}
          error -> {:halt, error}
        end
      end) |> case do {:ok, pages} -> normalize_pages({:ok, Enum.reverse(pages)}, s, fun); error -> error end
    end
  end

  defp normalize_pages({:ok, pages}, s, fun) do
    Enum.reduce_while(pages, {:ok, []}, fn page, {:ok, acc} ->
      with {:ok, blocks} <- blocks(page["id"], s, fun), {:ok, issue} <- normalize(page, blocks, s) do
        {:cont, {:ok, [issue | acc]}}
      else error -> {:halt, error} end
    end) |> case do {:ok, issues} -> {:ok, Enum.reverse(issues)}; error -> error end
  end
  defp normalize_pages(error, _s, _fun), do: error

  defp query_pages(s, filter, fun, cursor, acc) do
    body = %{"page_size" => @page_size, "filter" => filter} |> maybe("start_cursor", cursor)
    with {:ok, %{"results" => results, "has_more" => more} = payload} when is_list(results) <- api("POST", "/data_sources/#{s.data_source_id}/query", %{}, body, s, fun, false) do
      cond do
        more == false -> {:ok, acc ++ results}
        is_binary(payload["next_cursor"]) and payload["next_cursor"] != "" -> query_pages(s, filter, fun, payload["next_cursor"], acc ++ results)
        true -> {:error, :notion_missing_next_cursor}
      end
    else {:ok, _} -> {:error, :notion_unknown_payload}; error -> error end
  end

  defp blocks(page_id, s, fun), do: block_pages(page_id, s, fun, nil, [])
  defp block_pages(page_id, s, fun, cursor, acc) do
    with {:ok, %{"results" => results, "has_more" => more} = payload} when is_list(results) <- api("GET", "/blocks/#{URI.encode(page_id)}/children", %{"page_size" => @page_size} |> maybe("start_cursor", cursor), nil, s, fun, false) do
      cond do
        more == false -> {:ok, acc ++ results}
        is_binary(payload["next_cursor"]) and payload["next_cursor"] != "" -> block_pages(page_id, s, fun, payload["next_cursor"], acc ++ results)
        true -> {:error, :notion_missing_next_cursor}
      end
    else {:ok, _} -> {:error, :notion_unknown_payload}; error -> error end
  end

  defp surface(s, fun) do
    with {:ok, %{"data_sources" => [%{"id" => id}]}} <-
           api("GET", "/databases/#{s.database_id}", %{}, nil, s, fun, false),
         {:ok, schema} <- api("GET", "/data_sources/#{id}", %{}, nil, s, fun, false),
         :ok <- schema_ok(schema, id) do {:ok, Map.put(s, :data_source_id, id)} else
      {:error, _} = error -> error
      _ -> {:error, :notion_incompatible_surface}
    end
  end

  defp schema_ok(%{"properties" => props}, source) when is_map(props) do
    if Enum.all?(@properties, fn {name, type} -> get_in(props, [name, "type"]) == type end) and
         get_in(props, ["Blocked By", "relation", "data_source_id"]) == source and
         is_map(get_in(props, ["Blocked By", "relation", "single_property"])) and
         is_nil(get_in(props, ["Blocked By", "relation", "dual_property"])) do :ok else {:error, :notion_incompatible_schema} end
  end
  defp schema_ok(_, _), do: {:error, :notion_incompatible_schema}

  defp normalize(%{"id" => id, "properties" => p} = page, blocks, s) when is_map(p) do
    with {:ok, identifier} <- text_property(p["Identifier"]), {:ok, title} <- title_property(p["Title"]),
         {:ok, state} <- select_property(p["State"]), {:ok, description} <- plan(blocks), {:ok, blockers} <- relations(p["Blocked By"]) do
      {:ok, %Issue{id: id, native_ref: %{"page_id" => id, "data_source_id" => s.data_source_id}, identifier: identifier, title: title, description: description, state: state, priority: number(p["Priority"]), labels: labels(p["Labels"]), blocked_by: blockers, url: page["url"], dispatchable: true, created_at: datetime(page["created_time"]), updated_at: datetime(page["last_edited_time"])}}
    end
  end
  defp normalize(_, _, _), do: {:error, :notion_malformed_task}

  defp plan(blocks) do
    case Enum.split_while(blocks, &(heading(&1) != "Plan")) do
      {_, []} -> {:error, :notion_malformed_plan}
      {_, [_ | rest]} -> rest |> Enum.take_while(&(heading(&1) != "Workpad")) |> Enum.map(&block_text/1) |> Enum.join("\n") |> then(&{:ok, &1})
    end
  end
  defp heading(%{"type" => type} = block) when type in ["heading_1", "heading_2", "heading_3"], do: rich(get_in(block, [type, "rich_text"]))
  defp heading(_), do: nil
  defp block_text(%{"type" => type} = block) when is_binary(type), do: rich(get_in(block, [type, "rich_text"]))
  defp block_text(_), do: ""
  defp rich(items) when is_list(items), do: Enum.map_join(items, "", &(Map.get(&1, "plain_text") || get_in(&1, ["text", "content"]) || ""))
  defp rich(_), do: ""
  defp text_property(%{"type" => "rich_text", "rich_text" => v}), do: required(rich(v))
  defp text_property(_), do: {:error, :notion_malformed_task}
  defp title_property(%{"type" => "title", "title" => v}), do: required(rich(v))
  defp title_property(_), do: {:error, :notion_malformed_task}
  defp select_property(%{"type" => "select", "select" => %{"name" => v}}), do: required(v)
  defp select_property(_), do: {:error, :notion_malformed_task}
  defp relations(%{"type" => "relation", "relation" => values}) when is_list(values), do: if(Enum.all?(values, &(is_binary(&1["id"]) and &1["id"] != "")), do: {:ok, Enum.map(values, &%{"id" => &1["id"]})}, else: {:error, :notion_malformed_relation})
  defp relations(_), do: {:error, :notion_malformed_relation}
  defp number(%{"type" => "number", "number" => n}) when is_integer(n), do: n
  defp number(_), do: nil
  defp labels(%{"type" => "multi_select", "multi_select" => values}) when is_list(values), do: values |> Enum.flat_map(fn %{"name" => n} when is_binary(n) -> [String.trim(n)]; _ -> [] end) |> Enum.reject(&(&1 == "")) |> Enum.uniq()
  defp labels(_), do: []
  defp datetime(v) when is_binary(v), do: case DateTime.from_iso8601(v) do {:ok, d, _} -> d; _ -> nil end
  defp datetime(_), do: nil
  defp required(v) when is_binary(v), do: if(String.trim(v) == "", do: {:error, :notion_malformed_task}, else: {:ok, v})
  defp required(_), do: {:error, :notion_malformed_task}

  defp settings(tracker) do
    p = provider(tracker); token = setting(p["token"], System.get_env("NOTION_TOKEN")); database_id = setting(p["database_id"], nil)
    cond do not endpoint?(p["endpoint"] || @endpoint) -> {:error, :invalid_notion_endpoint}; not present?(token) -> {:error, :missing_notion_token}; not present?(database_id) -> {:error, :missing_notion_database_id}; true -> {:ok, %{endpoint: String.trim_trailing(p["endpoint"] || @endpoint, "/"), token: token, database_id: database_id}} end
  end
  defp perform_request(method, path, query, body, s) do
    opts = [method: String.downcase(method) |> String.to_atom(), url: s.endpoint <> path, headers: [{"Authorization", "Bearer #{s.token}"}, {"Notion-Version", @version}], params: query, connect_options: [timeout: 30_000]] |> then(fn o -> if is_nil(body), do: o, else: Keyword.put(o, :json, body) end)
    case Req.request(opts) do {:ok, r} -> {:ok, %{status: r.status, body: r.body}}; {:error, reason} -> {:error, {:notion_api_request, reason}} end
  end
  defp api(method,path,q,b,s,fun,not_found) do
    case fun.(method,path,q,b,s) do
      {:ok,%{status: status,body: body}} when status in 200..299 -> {:ok,body}
      {:ok,%{status: 404}} when not_found -> {:ok,:not_found}
      {:ok,%{status: status}} when is_integer(status) -> {:error,{:notion_api_status,status}}
      {:error,_}=e -> e
      _ -> {:error,:notion_unknown_payload}
    end
  end
  defp provider(%{provider: p}) when is_map(p), do: p
  defp provider(_), do: %{}
  defp setting("$" <> env, fallback), do: if(String.match?(env, ~r/^[A-Za-z_][A-Za-z0-9_]*$/), do: setting(System.get_env(env) || fallback, nil), else: nil)
  defp setting(v, _fallback) when is_binary(v), do: v |> String.trim() |> case do "" -> nil; x -> x end
  defp setting(nil, fallback), do: setting(fallback || "", nil)
  defp setting(_, _), do: nil
  defp env_names(values), do: Enum.flat_map(values, fn "$" <> n -> if String.match?(n, ~r/^[A-Za-z_][A-Za-z0-9_]*$/), do: [n], else: []; _ -> [] end)
  defp endpoint?(v) when is_binary(v), do: match?(%URI{scheme: "https", host: host} when is_binary(host), URI.parse(v))
  defp endpoint?(_), do: false
  defp present?(v) when is_binary(v), do: String.trim(v) != ""
  defp present?(_), do: false
  defp maybe(map,_k,nil), do: map
  defp maybe(map,k,v), do: Map.put(map,k,v)
end
