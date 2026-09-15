defmodule SymphonyElixir.Notion.Client do
  @moduledoc "HTTP boundary for Notion's 2025-09-03 database/data-source API."
  require Logger
  alias SymphonyElixir.Config
  alias SymphonyElixir.Tracker.Issue

  @api "2025-09-03"
  @endpoint "https://api.notion.com/v1"
  @required %{
    "Identifier" => ["rich_text"],
    "Title" => ["title"],
    "State" => ["select"],
    "Priority" => ["number"],
    "Labels" => ["multi_select"],
    "Blocked By" => ["relation"],
    "Plan" => ["relation"]
  }
  @plan_forbidden ["State", "Priority", "Labels", "Blocked By", "Plan", "Workpad", "Description", "Plan Source", "branch_name", "assignee_id", "native_ref"]

  @spec validate_settings(map()) :: :ok | {:error, term()}
  def validate_settings(settings) do
    with {:ok, _} <- settings(settings), do: :ok
  end

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(%{secret_environment_names: names}) when is_list(names), do: names

  def secret_environment_names(settings), do: ["NOTION_TOKEN" | env_refs([settings.provider["token"]])]

  @spec resolve_task_data_source(map()) :: {:ok, String.t()} | {:error, term()}
  def resolve_task_data_source(tracker_settings) do
    with {:ok, settings} <- settings(tracker_settings),
         {:ok, db} <- request("GET", "/databases/#{settings.database_id}", %{}, nil, settings),
         {:ok, binding} <- compatible_sources(db, settings) do
      {:ok, binding.task}
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

      options = [
        method: String.to_atom(String.downcase(method)),
        url: url,
        params: query,
        json: body,
        headers: [
          {"authorization", "Bearer #{request_settings.token}"},
          {"notion-version", @api}
        ]
      ]

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
    with {:ok, settings} <- settings(tracker), {:ok, binding} <- resolve_source(settings, fun), {:ok, pages} <- query_states(binding.task, states, settings, fun) do
      normalize_poll_pages(pages, binding.task, binding.plan, settings, fun)
    end
  end

  defp fetch_issues_by_ids([], _, _), do: {:ok, []}

  defp fetch_issues_by_ids(ids, tracker, fun) do
    with {:ok, settings} <- settings(tracker), {:ok, binding} <- resolve_source(settings, fun) do
      ids
      |> Enum.uniq()
      |> Enum.reduce_while({:ok, []}, &fetch_page(&1, &2, binding, settings, fun))
      |> reverse_ok()
      |> ensure_unique_identifiers()
    end
  end

  defp fetch_page(id, {:ok, acc}, binding, settings, fun) do
    case fun.("GET", "/pages/#{id}", %{}, nil, settings) do
      {:error, :notion_not_found} ->
        {:cont, {:ok, acc}}

      {:ok, page} ->
        fetched_page(page, id, binding, settings, fun, acc)

      {:error, reason} ->
        {:halt, {:error, reason}}
    end
  end

  defp fetched_page(page, id, %{task: task, plan: plan}, settings, fun, acc) do
    case parent_source(page) do
      ^task ->
        case normalize_page(page, task, plan, settings, fun) do
          {:ok, issue} -> {:cont, {:ok, [issue | acc]}}
          {:error, reason} -> {:halt, {:error, {:notion_malformed_task_representation, id, reason}}}
        end

      _ ->
        {:cont, {:ok, acc}}
    end
  end

  defp resolve_source(settings, fun) do
    with {:ok, db} <- fun.("GET", "/databases/#{settings.database_id}", %{}, nil, settings) do
      compatible_sources(db, settings, fun)
    end
  end

  defp compatible_sources(db, settings), do: compatible_sources(db, settings, &request/5)

  defp compatible_sources(%{"data_sources" => sources}, settings, fun) when is_list(sources) do
    sources
    |> Enum.reduce_while({:ok, []}, fn
      %{"id" => id}, {:ok, acc} when is_binary(id) ->
        case fun.("GET", "/data_sources/#{id}", %{}, nil, settings) do
          {:ok, ds} when is_map(ds) -> {:cont, {:ok, [%{id: id, properties: ds["properties"]} | acc]}}
          {:ok, _} -> {:halt, {:error, :notion_malformed_provider_response}}
          {:error, reason} -> {:halt, {:error, reason}}
        end

      _, _ ->
        {:halt, {:error, :notion_malformed_provider_response}}
    end)
    |> reverse_ok()
    |> select_task_and_plan()
  end

  defp compatible_sources(_, _, _), do: {:error, :notion_malformed_provider_response}

  defp select_task_and_plan({:ok, sources}) do
    tasks = Enum.filter(sources, &task_schema?/1)

    case tasks do
      [%{id: task_id, properties: properties}] ->
        plan_id = get_in(properties, ["Plan", "relation", "data_source_id"])
        plan = Enum.find(sources, &(&1.id == plan_id))

        plans = Enum.filter(sources, &plan_schema?/1)

        cond do
          length(plans) > 1 -> {:error, :notion_ambiguous_plan_data_source}
          is_binary(plan_id) and plan_schema?(plan) -> {:ok, %{task: task_id, plan: plan_id}}
          true -> {:error, :notion_incompatible_task_data_source}
        end

      [] ->
        {:error, :notion_incompatible_task_data_source}

      _ ->
        {:error, :notion_ambiguous_task_data_source}
    end
  end

  defp select_task_and_plan(error), do: error

  defp task_schema?(%{id: id, properties: properties}) when is_binary(id) and is_map(properties) do
    Enum.all?(@required, fn {name, types} -> get_in(properties, [name, "type"]) in types end) and
      get_in(properties, ["Blocked By", "relation", "data_source_id"]) == id and
      has_single_relation?(properties["Blocked By"]) and
      has_single_relation?(properties["Plan"])
  end

  defp task_schema?(_), do: false

  defp plan_schema?(%{properties: properties}) when is_map(properties) do
    get_in(properties, ["Identifier", "type"]) == "rich_text" and get_in(properties, ["Title", "type"]) == "title" and
      map_size(properties) == 2 and
      not Enum.any?(@plan_forbidden, &Map.has_key?(properties, &1))
  end

  defp plan_schema?(_), do: false

  defp has_single_relation?(%{"type" => "relation", "relation" => relation}), do: is_map(relation) and is_nil(relation["dual_property"])
  defp has_single_relation?(_), do: false

  defp query_states(source, states, settings, fun), do: query_states(source, states, settings, fun, nil, [])

  defp query_states(source, states, settings, fun, cursor, acc) do
    body =
      %{
        "page_size" => 100,
        "filter" => %{
          "or" => Enum.map(states, &%{"property" => "State", "select" => %{"equals" => &1}})
        }
      }
      |> maybe_cursor(cursor)

    with {:ok, response} <-
           fun.("POST", "/data_sources/#{source}/query", %{}, body, settings),
         {:ok, results, next} <- pagination(response) do
      query_page(source, states, settings, fun, next, results ++ acc)
    end
  end

  defp query_page(source, states, settings, fun, next, results) do
    if next, do: query_states(source, states, settings, fun, next, results), else: {:ok, Enum.reverse(results)}
  end

  defp normalize_poll_pages(pages, task_source, plan_source, settings, fun) do
    {issues, errors} =
      Enum.reduce(pages, {[], []}, fn page, {ok, bad} ->
        case normalize_page(page, task_source, plan_source, settings, fun) do
          {:ok, issue} -> {[issue | ok], bad}
          {:error, reason} -> {ok, [reason | bad]}
        end
      end)

    if errors != [], do: Logger.warning("Dropping malformed Notion task records count=#{length(errors)}")
    {:ok, Enum.reverse(issues)} |> ensure_unique_identifiers()
  end

  defp normalize_page(%{"id" => id, "properties" => props} = page, task_source, plan_source, settings, fun) when is_map(props) do
    with true <- parent_source(page) == task_source or {:error, :out_of_scope},
         {:ok, identifier} <- text_property(props["Identifier"], ["rich_text", "title"]),
         true <- present?(identifier) or {:error, :empty_identifier},
         {:ok, title} <- text_property(props["Title"], ["title"]),
         {:ok, state} <- state_property(props["State"]),
         {:ok, priority} <- priority_property(props["Priority"]),
         {:ok, labels} <- labels_property(props["Labels"]),
         {:ok, blockers} <- blockers(props["Blocked By"], id, settings, fun),
         {:ok, plan} <- plan_page(props["Plan"], id, identifier, plan_source, settings, fun),
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

  defp normalize_page(_, _, _, _, _), do: {:error, :malformed_page}

  defp plan_page(%{"type" => "relation", "relation" => related} = property, page_id, identifier, plan_source, settings, fun) when is_list(related) do
    refs = relation_values(property, related, page_id, settings, fun, :invalid_plan_relation)

    with {:ok, refs} <- refs,
         [reference] <- refs,
         plan_id when is_binary(plan_id) <- relation_page_id(reference),
         {:ok, plan} when is_map(plan) <- fun.("GET", "/pages/#{plan_id}", %{}, nil, settings),
         true <- parent_source(plan) == plan_source or {:error, :out_of_scope_plan},
         {:ok, plan_identifier} <- text_property(get_in(plan, ["properties", "Identifier"]), ["rich_text", "title"]),
         true <- plan_identifier == identifier or {:error, :plan_identifier_mismatch} do
      {:ok, plan_id}
    else
      {:error, _} = error -> error
      _ -> {:error, :invalid_plan_relation}
    end
  end

  defp plan_page(_, _, _, _, _, _), do: {:error, :invalid_plan_relation}

  defp relation_values(%{"has_more" => true, "id" => property_id}, _related, page_id, settings, fun, _error)
       when is_binary(property_id),
       do: property_refs(page_id, property_id, settings, fun)

  defp relation_values(property, related, _page_id, _settings, _fun, _error)
       when not is_map_key(property, "has_more"),
       do: {:ok, related}

  defp relation_values(%{"has_more" => value}, related, _page_id, _settings, _fun, _error)
       when value in [false, nil],
       do: {:ok, related}

  defp relation_values(_property, _related, _page_id, _settings, _fun, error), do: {:error, error}

  defp page_text(id, settings, fun) do
    with {:ok, blocks} <- all_children(id, settings, fun) do
      plan_text_blocks(blocks)
    end
  end

  defp plan_text_blocks(blocks) do
    blocks
    |> Enum.reduce_while({:ok, []}, &plan_text_block/2)
    |> case do
      {:ok, values} -> {:ok, values |> Enum.reverse() |> Enum.join("")}
      error -> error
    end
  end

  defp plan_text_block(
         %{"type" => "paragraph", "paragraph" => %{"rich_text" => values}},
         {:ok, acc}
       )
       when is_list(values) do
    if valid_rich_text?(values) do
      {:cont, {:ok, [rich_text(values) | acc]}}
    else
      {:halt, {:error, :malformed_plan_content}}
    end
  end

  defp plan_text_block(_, _), do: {:halt, {:error, :malformed_plan_content}}

  defp all_children(id, settings, fun), do: all_children(id, settings, fun, nil, [])

  defp all_children(id, settings, fun, cursor, acc) do
    with {:ok, response} <-
           fun.("GET", "/blocks/#{id}/children", maybe_cursor(%{}, cursor), nil, settings),
         {:ok, results, next} <- pagination(response) do
      if next, do: all_children(id, settings, fun, next, acc ++ results), else: {:ok, acc ++ results}
    end
  end

  defp blockers(%{"type" => "relation", "relation" => related} = prop, page_id, settings, fun) when is_list(related) do
    refs = relation_values(prop, related, page_id, settings, fun, :invalid_blocked_by)

    with {:ok, refs} <- refs do
      {:ok,
       Enum.map(refs, fn reference ->
         id = relation_page_id(reference)

         case fun.("GET", "/pages/#{id}", %{}, nil, settings) do
           {:ok, page} -> blocker(page, id, settings)
           _ -> %{"id" => id, "state" => nil, "terminal" => false}
         end
       end)}
    end
  end

  defp blockers(_, _, _, _), do: {:error, :invalid_blocked_by}

  defp blocker(page, id, settings) do
    state = value_state(get_in(page, ["properties", "State"]))
    %{"id" => id, "state" => state, "terminal" => state in settings.terminal_states}
  end

  defp relation_page_id(%{"relation" => %{"id" => id}}) when is_binary(id), do: id
  defp relation_page_id(%{"id" => id}) when is_binary(id), do: id
  defp relation_page_id(_), do: nil
  defp property_refs(page, prop, settings, fun), do: property_refs(page, prop, settings, fun, nil, [])

  defp property_refs(page, prop, settings, fun, cursor, acc) do
    with {:ok, response} <-
           fun.("GET", "/pages/#{page}/properties/#{prop}", maybe_cursor(%{}, cursor), nil, settings),
         {:ok, results, next} <- pagination(response) do
      property_refs_page(page, prop, settings, fun, next, results ++ acc)
    end
  end

  defp property_refs_page(page, prop, settings, fun, next, results) do
    if next, do: property_refs(page, prop, settings, fun, next, results), else: {:ok, Enum.reverse(results)}
  end

  defp text_property(%{"type" => type} = p, types) do
    if type in types, do: text_property_values(p[type]), else: {:error, :invalid_property}
  end

  defp text_property(_, _), do: {:error, :invalid_property}

  defp text_property_values(values) when is_list(values) do
    if Enum.all?(values, &is_map/1), do: {:ok, rich_text(values)}, else: {:error, :invalid_property}
  end

  defp text_property_values(_), do: {:error, :invalid_property}

  defp state_property(property) do
    case property do
      %{"type" => "select", "select" => %{"name" => value}} when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, :invalid_state}
    end
  end

  defp priority_property(%{"type" => "number", "number" => n}) when is_number(n), do: {:ok, round(n)}
  defp priority_property(_), do: {:error, :invalid_priority}

  defp labels_property(%{"type" => "multi_select", "multi_select" => values}) when is_list(values),
    do:
      {:ok,
       Enum.flat_map(values, fn
         %{"name" => n} when is_binary(n) -> [n]
         _ -> []
       end)}

  defp labels_property(_), do: {:error, :invalid_labels}

  defp value_state(property) do
    case property do
      %{"type" => "select", "select" => %{"name" => value}} when is_binary(value) -> value
      _ -> nil
    end
  end

  defp rich_text(values) when is_list(values), do: Enum.map_join(values, "", fn value -> Map.get(value, "plain_text") || get_in(value, ["text", "content"]) || "" end)
  defp rich_text(_), do: ""
  defp valid_rich_text?(values) when is_list(values), do: Enum.all?(values, &(is_map(&1) and (is_binary(&1["plain_text"]) or is_binary(get_in(&1, ["text", "content"])))))
  defp valid_rich_text?(_), do: false
  defp parent_source(%{"parent" => %{"type" => "data_source_id", "data_source_id" => id}}), do: id
  defp parent_source(_), do: nil

  defp pagination(%{"results" => r, "has_more" => more} = p) when is_list(r) and is_boolean(more),
    do:
      if(more and not is_binary(p["next_cursor"]),
        do: {:error, :notion_pagination_integrity_failure},
        else: {:ok, r, if(more, do: p["next_cursor"], else: nil)}
      )

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
    with token when is_binary(token) and token != "" <- provider["token"],
         url when is_binary(url) <- provider["database_url"],
         {:ok, id} <- database_id(url) do
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
