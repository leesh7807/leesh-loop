defmodule SymphonyElixir.Notion.Client do
  @moduledoc """
  Notion HTTP access and mechanical Publisher-surface normalization.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.Tracker.Issue

  @api_url "https://api.notion.com/v1"
  @notion_version "2022-06-28"
  @page_size 100
  @required_properties %{
    "Identifier" => "rich_text",
    "Title" => "title",
    "State" => "select",
    "Priority" => "number",
    "Labels" => "multi_select",
    "Blocked By" => "relation",
    "Description" => "rich_text"
  }

  @spec validate_settings(map()) :: :ok | {:error, term()}
  def validate_settings(tracker_settings) do
    with {:ok, _settings} <- settings(tracker_settings), do: :ok
  end

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(tracker_settings) do
    provider(tracker_settings)
    |> Map.get("token")
    |> env_reference_names()
    |> then(&Enum.uniq(["NOTION_TOKEN" | &1]))
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states) when is_list(states) do
    fetch_issues_by_states(states, Config.settings!().tracker, &perform_request/5)
  end

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids) when is_list(ids) do
    fetch_issues_by_ids(ids, Config.settings!().tracker, &perform_request/5)
  end

  @spec request(String.t(), String.t(), map(), term(), keyword()) ::
          {:ok, %{status: integer(), body: term()}} | {:error, term()}
  def request(method, path, params, body, opts \\ []) do
    tracker_settings = Keyword.get_lazy(opts, :tracker_settings, fn -> Config.settings!().tracker end)
    request_fun = Keyword.get(opts, :request_fun, &perform_request/5)

    with {:ok, notion_settings} <- settings(tracker_settings) do
      request_fun.(method, path, params, body, notion_settings)
    end
  end

  @doc false
  @spec normalize_issue_for_test(map(), [map()]) :: {:ok, Issue.t()} | {:error, term()}
  def normalize_issue_for_test(page, blocks) when is_map(page) and is_list(blocks), do: normalize_issue(page, blocks)

  @doc false
  @spec fetch_issues_by_states_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states_for_test(states, tracker_settings, request_fun), do: fetch_issues_by_states(states, tracker_settings, request_fun)

  @doc false
  @spec fetch_issues_by_ids_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids_for_test(ids, tracker_settings, request_fun), do: fetch_issues_by_ids(ids, tracker_settings, request_fun)

  defp fetch_issues_by_states(states, tracker_settings, request_fun) do
    requested_states = states |> Enum.filter(&present_string?/1) |> Enum.map(&String.trim/1) |> Enum.uniq()

    with {:ok, settings} <- settings(tracker_settings),
         :ok <- validate_surface(settings, request_fun) do
      fetch_state_pages(requested_states, settings, request_fun, [])
    end
  end

  defp fetch_state_pages([], _settings, _request_fun, issues), do: {:ok, issues |> Enum.reverse() |> List.flatten()}

  defp fetch_state_pages([state | rest], settings, request_fun, pages) do
    with {:ok, state_pages} <- fetch_state_pages(state, nil, settings, request_fun, []),
         {:ok, issues} <- normalize_pages(state_pages, settings, request_fun) do
      fetch_state_pages(rest, settings, request_fun, [issues | pages])
    end
  end

  defp fetch_state_pages(state, cursor, settings, request_fun, acc) do
    body = %{"page_size" => @page_size, "filter" => %{"property" => "State", "select" => %{"equals" => state}}}
    body = if cursor, do: Map.put(body, "start_cursor", cursor), else: body

    with {:ok, %{"results" => results} = payload} <- api_request("POST", database_query_path(settings), %{}, body, settings, request_fun),
         true <- is_list(results) or {:error, :notion_malformed_response} do
      case payload do
        %{"has_more" => true, "next_cursor" => next} when is_binary(next) and next != "" -> fetch_state_pages(state, next, settings, request_fun, [results | acc])
        %{"has_more" => true} -> {:error, :notion_incomplete_pagination}
        _ -> {:ok, [results | acc] |> Enum.reverse() |> List.flatten()}
      end
    end
  end

  defp fetch_issues_by_ids(ids, tracker_settings, request_fun) do
    ids = ids |> Enum.filter(&present_string?/1) |> Enum.uniq()

    with {:ok, settings} <- settings(tracker_settings),
         :ok <- validate_surface(settings, request_fun) do
      fetch_id_pages(ids, settings, request_fun, [])
    end
  end

  defp fetch_id_pages([], _settings, _request_fun, acc), do: {:ok, Enum.reverse(acc)}

  defp fetch_id_pages([id | rest], settings, request_fun, acc) do
    case api_request("GET", "/pages/#{id}", %{}, nil, settings, request_fun) do
      {:ok, :not_found} -> fetch_id_pages(rest, settings, request_fun, acc)
      {:ok, page} -> with {:ok, issue} <- normalize_page(page, settings, request_fun), do: fetch_id_pages(rest, settings, request_fun, [issue | acc])
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize_pages(pages, settings, request_fun) do
    Enum.reduce_while(pages, {:ok, []}, fn page, {:ok, acc} ->
      case normalize_page(page, settings, request_fun) do
        {:ok, issue} -> {:cont, {:ok, [issue | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, issues} -> {:ok, Enum.reverse(issues)}
      error -> error
    end
  end

  defp normalize_page(page, settings, request_fun) do
    with {:ok, blocks} <- fetch_blocks(page["id"], nil, settings, request_fun, []),
         {:ok, issue} <- normalize_issue(page, blocks),
         {:ok, blockers} <- hydrate_blockers(issue.blocked_by, settings, request_fun) do
      {:ok, %{issue | blocked_by: blockers, dispatchable: blockers_terminal?(blockers, settings.terminal_states)}}
    end
  end

  defp hydrate_blockers([], _settings, _request_fun), do: {:ok, []}

  defp hydrate_blockers(blockers, settings, request_fun) when is_list(blockers) do
    Enum.reduce_while(blockers, {:ok, []}, fn %{"id" => id}, {:ok, acc} ->
      case api_request("GET", "/pages/#{id}", %{}, nil, settings, request_fun) do
        {:ok, %{"properties" => properties}} when is_map(properties) ->
          case select_property(properties, "State") do
            {:ok, state} -> {:cont, {:ok, [%{"id" => id, "state" => state} | acc]}}
            {:error, reason} -> {:halt, {:error, reason}}
          end

        {:ok, :not_found} ->
          {:halt, {:error, {:notion_inaccessible_dependency, id}}}

        {:ok, _} ->
          {:halt, {:error, {:notion_inaccessible_dependency, id}}}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, hydrated} -> {:ok, Enum.reverse(hydrated)}
      error -> error
    end
  end

  defp blockers_terminal?([], _terminal_states), do: true

  defp blockers_terminal?(blockers, terminal_states) when is_list(blockers) do
    terminal_states = MapSet.new(terminal_states, &(String.trim(&1) |> String.downcase()))

    Enum.all?(blockers, fn
      %{"state" => state} when is_binary(state) -> MapSet.member?(terminal_states, String.trim(state) |> String.downcase())
      _ -> false
    end)
  end

  defp fetch_blocks(page_id, cursor, settings, request_fun, acc) when is_binary(page_id) do
    params = if cursor, do: %{"page_size" => @page_size, "start_cursor" => cursor}, else: %{"page_size" => @page_size}

    with {:ok, %{"results" => results} = payload} <- api_request("GET", "/blocks/#{page_id}/children", params, nil, settings, request_fun),
         true <- is_list(results) or {:error, :notion_malformed_response} do
      case payload do
        %{"has_more" => true, "next_cursor" => next} when is_binary(next) and next != "" -> fetch_blocks(page_id, next, settings, request_fun, [results | acc])
        %{"has_more" => true} -> {:error, :notion_incomplete_pagination}
        _ -> {:ok, [results | acc] |> Enum.reverse() |> List.flatten()}
      end
    end
  end

  defp fetch_blocks(_, _, _, _, _), do: {:error, :notion_malformed_page}

  defp normalize_issue(%{"id" => id, "properties" => properties} = page, blocks) when is_map(properties) do
    with {:ok, identifier} <- property_text(properties, "Identifier", "rich_text"),
         {:ok, title} <- property_text(properties, "Title", "title"),
         {:ok, state} <- select_property(properties, "State"),
         {:ok, priority} <- number_property(properties, "Priority"),
         {:ok, labels} <- labels_property(properties),
         {:ok, blocked_by} <- relation_property(properties),
         {:ok, description} <- plan_section(blocks),
         true <- (present_string?(id) and present_string?(identifier) and present_string?(title) and present_string?(state)) or {:error, :notion_malformed_task} do
      {:ok,
       %Issue{
         id: id,
         native_ref: %{"page_id" => id},
         identifier: identifier,
         title: title,
         description: description,
         state: state,
         priority: priority,
         labels: labels,
         blocked_by: blocked_by,
         url: page["url"],
         dispatchable: true,
         created_at: parse_datetime(page["created_time"]),
         updated_at: parse_datetime(page["last_edited_time"])
       }}
    end
  end

  defp normalize_issue(_, _), do: {:error, :notion_malformed_task}

  defp validate_surface(settings, request_fun) do
    with {:ok, %{"properties" => properties}} <- api_request("GET", "/databases/#{settings.database_id}", %{}, nil, settings, request_fun),
         true <- is_map(properties) or {:error, :notion_incompatible_schema},
         :ok <- validate_properties(properties) do
      :ok
    else
      {:ok, _} -> {:error, :notion_incompatible_schema}
      error -> error
    end
  end

  defp validate_properties(properties) do
    Enum.reduce_while(@required_properties, :ok, fn {name, type}, :ok ->
      case properties do
        %{^name => %{"type" => ^type}} -> {:cont, :ok}
        _ -> {:halt, {:error, {:notion_incompatible_schema, name}}}
      end
    end)
  end

  defp property_text(properties, name, type) do
    case properties do
      %{^name => %{"type" => ^type} = property} -> {:ok, rich_text(property[type])}
      _ -> {:error, {:notion_malformed_required_property, name}}
    end
  end

  defp select_property(properties, name) do
    case properties do
      %{^name => %{"type" => "select", "select" => %{"name" => value}}} when is_binary(value) -> {:ok, value}
      _ -> {:error, {:notion_malformed_required_property, name}}
    end
  end

  defp number_property(properties, name) do
    case properties do
      %{^name => %{"type" => "number", "number" => value}} when is_integer(value) -> {:ok, value}
      %{^name => %{"type" => "number", "number" => nil}} -> {:ok, nil}
      _ -> {:error, {:notion_malformed_required_property, name}}
    end
  end

  defp labels_property(properties) do
    case properties do
      %{"Labels" => %{"type" => "multi_select", "multi_select" => values}} when is_list(values) ->
        {:ok,
         values
         |> Enum.flat_map(fn
           %{"name" => value} when is_binary(value) -> [value]
           _ -> []
         end)
         |> Enum.uniq()}

      _ ->
        {:error, {:notion_malformed_required_property, "Labels"}}
    end
  end

  defp relation_property(properties) do
    case properties do
      %{"Blocked By" => %{"type" => "relation", "relation" => values}} when is_list(values) ->
        {:ok,
         Enum.map(values, fn
           %{"id" => id} when is_binary(id) -> %{"id" => id}
           _ -> throw(:invalid_relation)
         end)}

      _ ->
        {:error, {:notion_malformed_required_property, "Blocked By"}}
    end
  catch
    :invalid_relation -> {:error, {:notion_malformed_required_property, "Blocked By"}}
  end

  defp plan_section(blocks) do
    plan_index = Enum.find_index(blocks, &section_heading?(&1, "Plan"))
    workpad_index = Enum.find_index(blocks, &section_heading?(&1, "Workpad"))

    case {plan_index, workpad_index} do
      {plan, workpad} when is_integer(plan) and is_integer(workpad) and workpad > plan ->
        {:ok,
         blocks
         |> Enum.slice(plan + 1, workpad - plan - 1)
         |> Enum.map(&block_text/1)
         |> Enum.reject(&(&1 == ""))
         |> Enum.join("\n")}

      _ ->
        {:error, :notion_incompatible_page_structure}
    end
  end

  defp section_heading?(%{"type" => "heading_1"} = block, expected), do: block_text(block) == expected
  defp section_heading?(_, _), do: false

  defp block_text(%{"type" => type} = block) when is_binary(type), do: block |> Map.get(type, %{}) |> Map.get("rich_text", []) |> rich_text()
  defp block_text(_), do: ""
  defp rich_text(values) when is_list(values), do: values |> Enum.map(&Map.get(&1, "plain_text", "")) |> Enum.join("")
  defp rich_text(_), do: ""

  defp parse_datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _} -> datetime
      _ -> nil
    end
  end

  defp parse_datetime(_), do: nil

  defp api_request(method, path, params, body, settings, request_fun) do
    case request_fun.(method, path, params, body, settings) do
      {:ok, %{status: status, body: payload}} when status in 200..299 -> {:ok, payload}
      {:ok, %{status: 404}} -> {:ok, :not_found}
      {:ok, %{status: status}} when is_integer(status) -> {:error, {:notion_api_status, status}}
      {:error, reason} -> {:error, reason}
      _ -> {:error, :notion_malformed_response}
    end
  end

  defp perform_request(method, path, params, body, settings) do
    opts = [method: request_method(method), url: @api_url <> path, headers: [{"Authorization", "Bearer #{settings.token}"}, {"Notion-Version", @notion_version}], params: params]
    opts = if is_nil(body), do: opts, else: Keyword.put(opts, :json, body)

    case Req.request(opts) do
      {:ok, response} -> {:ok, %{status: response.status, body: response.body}}
      {:error, reason} -> {:error, {:notion_api_request, reason}}
    end
  end

  defp settings(tracker_settings) when is_map(tracker_settings) do
    p = provider(tracker_settings)
    url = resolve(p["database_url"])
    token = resolve(p["token"] || System.get_env("NOTION_TOKEN"))

    with true <- present_string?(url) or {:error, :missing_notion_database_url}, {:ok, database_id} <- database_id(url), true <- present_string?(token) or {:error, :missing_notion_token} do
      {:ok, %{database_id: database_id, token: token, terminal_states: tracker_settings.terminal_states || []}}
    end
  end

  defp provider(%{provider: provider}) when is_map(provider), do: provider
  defp provider(_), do: %{}
  defp resolve("$" <> env) when is_binary(env), do: System.get_env(env)
  defp resolve(value), do: value

  defp database_id(url) when is_binary(url) do
    case Regex.run(~r/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{32})(?:\?.*)?$/i, url) do
      [_, id] ->
        {:ok,
         String.replace(id, "-", "")
         |> then(fn x -> String.slice(x, 0, 8) <> "-" <> String.slice(x, 8, 4) <> "-" <> String.slice(x, 12, 4) <> "-" <> String.slice(x, 16, 4) <> "-" <> String.slice(x, 20, 12) end)}

      _ ->
        {:error, :invalid_notion_database_url}
    end
  end

  defp database_id(_), do: {:error, :invalid_notion_database_url}
  defp present_string?(value), do: is_binary(value) and String.trim(value) != ""
  defp env_reference_names("$" <> name), do: if(String.match?(name, ~r/^[A-Za-z_][A-Za-z0-9_]*$/), do: [name], else: [])
  defp env_reference_names(_), do: []
  defp database_query_path(settings), do: "/databases/#{settings.database_id}/query"
  defp request_method("GET"), do: :get
  defp request_method("POST"), do: :post
  defp request_method("PATCH"), do: :patch
end
