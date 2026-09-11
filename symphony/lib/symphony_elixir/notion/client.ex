defmodule SymphonyElixir.Notion.Client do
  @moduledoc "HTTP boundary for Notion's 2025-09-03 database/data-source API."
  require Logger
  alias SymphonyElixir.Config
  alias SymphonyElixir.Tracker.Issue

  @api "2025-09-03"
  @endpoint "https://api.notion.com/v1"
  @required %{
    "Identifier" => ["rich_text", "title"],
    "Title" => ["title"],
    "State" => ["status"],
    "Priority" => ["number"],
    "Labels" => ["multi_select"],
    "Blocked By" => ["relation"]
  }

  @spec validate_settings(map()) :: :ok | {:error, term()}
  def validate_settings(settings) do
    with {:ok, _} <- settings(settings), do: :ok
  end

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(settings) do
    ["NOTION_TOKEN" | env_refs([get_in(settings, [:provider, "token"])])]
  end

  @spec resolve_task_data_source(map()) :: {:ok, String.t()} | {:error, term()}
  def resolve_task_data_source(tracker_settings) do
    with {:ok, settings} <- settings(tracker_settings),
         {:ok, db} <- request("GET", "/databases/#{settings.database_id}", %{}, nil, settings),
         {:ok, candidates} <- compatible_sources(db, settings) do
      case candidates do
        [id] -> {:ok, id}
        [] -> {:error, :notion_incompatible_task_data_source}
        _ -> {:error, :notion_ambiguous_task_data_source}
      end
    end
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: fetch_issues_by_states(states, Config.settings!().tracker, &request/5)

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids), do: fetch_issues_by_ids(ids, Config.settings!().tracker, &request/5)

  @doc false
  @spec fetch_issues_by_states_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states_for_test(states, settings, fun), do: fetch_issues_by_states(states, settings, fun)

  @doc false
  @spec fetch_issues_by_ids_for_test([String.t()], map(), function()) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids_for_test(ids, settings, fun), do: fetch_issues_by_ids(ids, settings, fun)

  @spec request(String.t(), String.t(), map(), term(), map()) :: {:ok, map()} | {:error, term()}
  def request(method, path, query, body, settings) do
    with {:ok, request_settings} <- settings(settings) do
      url = @endpoint <> path
      options = [method: String.to_atom(String.downcase(method)), url: url, params: query, json: body, headers: [{"authorization", "Bearer #{request_settings.token}"}, {"notion-version", @api}]]

      case Req.request(options) do
        {:ok, %{status: status, body: response}} when status in 200..299 and is_map(response) -> {:ok, response}
        {:ok, %{status: 404}} -> {:error, :notion_not_found}
        {:ok, %{status: 429}} -> {:error, :notion_rate_limited}
        {:ok, %{status: status, body: response_body}} -> {:error, {:notion_provider_response, status, response_body}}
        {:error, reason} -> {:error, {:notion_transport_failure, reason}}
      end
    end
  end

  @spec api_version() :: String.t()
  def api_version, do: @api

  defp fetch_issues_by_states([], _, _), do: {:ok, []}

  defp fetch_issues_by_states(states, tracker, fun) do
    with {:ok, settings} <- settings(tracker), {:ok, source} <- resolve_source(settings, fun), {:ok, pages} <- query_states(source, states, settings, fun) do
      normalize_poll_pages(pages, source, settings, fun)
    end
  end

  defp fetch_issues_by_ids([], _, _), do: {:ok, []}

  defp fetch_issues_by_ids(ids, tracker, fun) do
    with {:ok, settings} <- settings(tracker), {:ok, source} <- resolve_source(settings, fun) do
      ids
      |> Enum.uniq()
      |> Enum.reduce_while({:ok, []}, fn id, {:ok, acc} ->
        case fun.("GET", "/pages/#{id}", %{}, nil, settings) do
          {:error, :notion_not_found} ->
            {:cont, {:ok, acc}}

          {:ok, page} ->
            if parent_source(page) != source do
              {:cont, {:ok, acc}}
            else
              case normalize_page(page, source, settings, fun) do
                {:ok, issue} -> {:cont, {:ok, [issue | acc]}}
                {:error, reason} -> {:halt, {:error, {:notion_malformed_task_representation, id, reason}}}
              end
            end

          {:error, reason} ->
            {:halt, {:error, reason}}
        end
      end)
      |> reverse_ok()
      |> ensure_unique_identifiers()
    end
  end

  defp resolve_source(settings, fun) do
    with {:ok, db} <- fun.("GET", "/databases/#{settings.database_id}", %{}, nil, settings),
         {:ok, candidates} <- compatible_sources(db, settings, fun) do
      case candidates do
        [id] -> {:ok, id}
        [] -> {:error, :notion_incompatible_task_data_source}
        _ -> {:error, :notion_ambiguous_task_data_source}
      end
    end
  end

  defp compatible_sources(db, settings), do: compatible_sources(db, settings, &request/5)

  defp compatible_sources(%{"data_sources" => sources}, settings, fun) when is_list(sources) do
    sources
    |> Enum.reduce_while({:ok, []}, fn %{"id" => id}, {:ok, acc} ->
      case fun.("GET", "/data_sources/#{id}", %{}, nil, settings) do
        {:ok, ds} -> if schema?(ds["properties"]), do: {:cont, {:ok, [id | acc]}}, else: {:cont, {:ok, acc}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> reverse_ok()
  end

  defp compatible_sources(_, _, _), do: {:error, :notion_malformed_provider_response}
  defp schema?(properties) when is_map(properties), do: Enum.all?(@required, fn {name, types} -> get_in(properties, [name, "type"]) in types end)
  defp schema?(_), do: false

  defp query_states(source, states, settings, fun), do: query_states(source, states, settings, fun, nil, [])

  defp query_states(source, states, settings, fun, cursor, acc) do
    body = %{"page_size" => 100, "filter" => %{"or" => Enum.map(states, &%{"property" => "State", "status" => %{"equals" => &1}})}} |> maybe_cursor(cursor)

    with {:ok, response} <- fun.("POST", "/data_sources/#{source}/query", %{}, body, settings),
         {:ok, results, next} <- pagination(response) do
      if next, do: query_states(source, states, settings, fun, next, results ++ acc), else: {:ok, Enum.reverse(results ++ acc)}
    end
  end

  defp normalize_poll_pages(pages, source, settings, fun) do
    {issues, errors} =
      Enum.reduce(pages, {[], []}, fn page, {ok, bad} ->
        case normalize_page(page, source, settings, fun) do
          {:ok, issue} -> {[issue | ok], bad}
          {:error, reason} -> {ok, [reason | bad]}
        end
      end)

    if errors != [], do: Logger.warning("Dropping malformed Notion task records count=#{length(errors)}")
    {:ok, Enum.reverse(issues)} |> ensure_unique_identifiers()
  end

  defp normalize_page(%{"id" => id, "properties" => props} = page, source, settings, fun) when is_map(props) do
    with true <- parent_source(page) == source or {:error, :out_of_scope},
         {:ok, identifier} <- text_property(props["Identifier"], ["rich_text", "title"]),
         true <- present?(identifier) or {:error, :empty_identifier},
         {:ok, title} <- text_property(props["Title"], ["title"]),
         {:ok, state} <- state_property(props["State"]),
         {:ok, priority} <- priority_property(props["Priority"]),
         {:ok, labels} <- labels_property(props["Labels"]),
         {:ok, blockers} <- blockers(props["Blocked By"], id, settings, fun),
         {:ok, plan, _workpad} <- surfaces(id, settings, fun),
         {:ok, description} <- page_text(plan, settings, fun),
         true <- present?(description) or {:error, :empty_plan} do
      {:ok,
       %Issue{
         id: id,
         native_ref: nil,
         identifier: identifier,
         title: title,
         state: state,
         priority: priority,
         labels: labels,
         blocked_by: blockers,
         dispatchable: Enum.all?(blockers, &(&1["terminal"] == true)),
         description: description,
         branch_name: nil,
         assignee_id: nil,
         url: page["url"],
         created_at: datetime(page["created_time"]),
         updated_at: datetime(page["last_edited_time"])
       }}
    else
      false -> {:error, :malformed}
      {:error, _} = error -> error
      _ -> {:error, :malformed}
    end
  end

  defp normalize_page(_, _, _, _), do: {:error, :malformed_page}

  defp surfaces(page_id, settings, fun) do
    with {:ok, children} <- all_children(page_id, settings, fun),
         plans = Enum.filter(children, &(child_title(&1) == "Plan")),
         workpads = Enum.filter(children, &(child_title(&1) == "Workpad")),
         [plan] <- plans,
         [workpad] <- workpads do
      {:ok, plan["id"], workpad["id"]}
    else
      _ -> {:error, :invalid_structural_surface}
    end
  end

  defp page_text(id, settings, fun) do
    with {:ok, blocks} <- all_children(id, settings, fun) do
      text = blocks |> Enum.map(&rich_text/1) |> Enum.join("\n") |> String.trim()
      {:ok, text}
    end
  end

  defp all_children(id, settings, fun), do: all_children(id, settings, fun, nil, [])

  defp all_children(id, settings, fun, cursor, acc) do
    with {:ok, response} <- fun.("GET", "/blocks/#{id}/children", maybe_cursor(%{}, cursor), nil, settings), {:ok, results, next} <- pagination(response) do
      if next, do: all_children(id, settings, fun, next, acc ++ results), else: {:ok, acc ++ results}
    end
  end

  defp blockers(%{"type" => "relation", "relation" => related} = prop, page_id, settings, fun) when is_list(related) do
    refs = if prop["has_more"], do: property_refs(page_id, prop["id"], settings, fun), else: {:ok, related}

    with {:ok, refs} <- refs do
      {:ok,
       Enum.map(refs, fn reference ->
         id = relation_page_id(reference)

         case fun.("GET", "/pages/#{id}", %{}, nil, settings) do
           {:ok, page} -> %{"id" => id, "state" => value_state(get_in(page, ["properties", "State"])), "terminal" => value_state(get_in(page, ["properties", "State"])) in settings.terminal_states}
           _ -> %{"id" => id, "state" => nil, "terminal" => false}
         end
       end)}
    end
  end

  defp blockers(_, _, _, _), do: {:error, :invalid_blocked_by}

  defp relation_page_id(%{"relation" => %{"id" => id}}) when is_binary(id), do: id
  defp relation_page_id(%{"id" => id}) when is_binary(id), do: id
  defp relation_page_id(_), do: nil
  defp property_refs(page, prop, settings, fun), do: property_refs(page, prop, settings, fun, nil, [])

  defp property_refs(page, prop, settings, fun, cursor, acc) do
    with {:ok, response} <- fun.("GET", "/pages/#{page}/properties/#{prop}", maybe_cursor(%{}, cursor), nil, settings), {:ok, results, next} <- pagination(response) do
      if next, do: property_refs(page, prop, settings, fun, next, results ++ acc), else: {:ok, Enum.reverse(results ++ acc)}
    end
  end

  defp text_property(%{"type" => type} = p, types) do
    if type in types do
      {:ok, p[type] |> List.wrap() |> Enum.map(&Map.get(&1, "plain_text", "")) |> Enum.join("")}
    else
      {:error, :invalid_property}
    end
  end

  defp text_property(_, _), do: {:error, :invalid_property}

  defp state_property(%{"type" => "status"} = p) do
    case get_in(p, ["status", "name"]) do
      v when is_binary(v) and v != "" -> {:ok, v}
      _ -> {:error, :invalid_state}
    end
  end

  defp state_property(_), do: {:error, :invalid_state}
  defp priority_property(%{"type" => "number", "number" => n}) when is_integer(n), do: {:ok, n}
  defp priority_property(_), do: {:error, :invalid_priority}

  defp labels_property(%{"type" => "multi_select", "multi_select" => values}) when is_list(values),
    do:
      {:ok,
       Enum.flat_map(values, fn
         %{"name" => n} when is_binary(n) -> [n]
         _ -> []
       end)}

  defp labels_property(_), do: {:error, :invalid_labels}
  defp value_state(%{"type" => "status"} = p), do: get_in(p, ["status", "name"])
  defp value_state(_), do: nil
  defp child_title(%{"type" => "child_page", "child_page" => %{"title" => t}}), do: t
  defp child_title(_), do: nil
  defp rich_text(%{"type" => type} = block), do: block |> get_in([type, "rich_text"]) |> List.wrap() |> Enum.map(&Map.get(&1, "plain_text", "")) |> Enum.join("")
  defp rich_text(_), do: ""
  defp parent_source(%{"parent" => %{"type" => "data_source_id", "data_source_id" => id}}), do: id
  defp parent_source(_), do: nil

  defp pagination(%{"results" => r, "has_more" => more} = p) when is_list(r) and is_boolean(more),
    do: if(more and not is_binary(p["next_cursor"]), do: {:error, :notion_pagination_integrity_failure}, else: {:ok, r, if(more, do: p["next_cursor"], else: nil)})

  defp pagination(_), do: {:error, :notion_malformed_provider_response}
  defp maybe_cursor(map, nil), do: map
  defp maybe_cursor(map, cursor), do: Map.put(map, "start_cursor", cursor)
  defp reverse_ok({:ok, v}), do: {:ok, Enum.reverse(v)}
  defp reverse_ok(error), do: error

  defp ensure_unique_identifiers({:ok, issues}) do
    identifiers = MapSet.new(issues, fn issue -> issue.identifier end)

    if length(issues) == MapSet.size(identifiers) do
      {:ok, issues}
    else
      {:error, :notion_tracker_identity_invariant_violation}
    end
  end

  defp ensure_unique_identifiers(error), do: error
  defp present?(v), do: is_binary(v) and String.trim(v) != ""

  defp datetime(v) when is_binary(v) do
    case DateTime.from_iso8601(v) do
      {:ok, d, _} -> d
      _ -> nil
    end
  end

  defp datetime(_), do: nil

  defp settings(%{token: token, database_id: database_id} = settings)
       when is_binary(token) and is_binary(database_id), do: {:ok, settings}

  defp settings(%{provider: provider} = tracker) when is_map(provider) do
    with token when is_binary(token) and token != "" <- provider["token"], url when is_binary(url) <- provider["database_url"], {:ok, id} <- database_id(url) do
      {:ok, %{token: token, database_id: id, terminal_states: tracker.terminal_states || []}}
    else
      _ -> {:error, :invalid_notion_tracker_configuration}
    end
  end

  defp settings(_), do: {:error, :invalid_notion_tracker_configuration}

  defp database_id(url) do
    case Regex.run(~r/([0-9a-fA-F]{32})(?:[?#].*)?$/, url) do
      [_, id] -> {:ok, id}
      _ -> {:error, :invalid_notion_database_url}
    end
  end

  defp env_refs(["$" <> name]) when name != "", do: [name]
  defp env_refs(_), do: []
end
