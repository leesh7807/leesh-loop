defmodule SymphonyElixir.Notion.CurrentTaskBlockedBy do
  @moduledoc "Add one canonical task as a blocker of the runtime-bound task."

  alias SymphonyElixir.Notion.Client

  @spec add(String.t(), String.t(), map(), map(), function()) :: {:ok, map()} | {:error, term()}
  def add(current_task_id, blocker_page_id, binding, settings, client)
      when is_binary(current_task_id) and is_binary(blocker_page_id) do
    with {:ok, source_id} <- binding_source(binding),
         false <- if(current_task_id == blocker_page_id, do: {:error, :notion_self_blocker}, else: false),
         {:ok, current_task} <- bound_page(current_task_id, source_id, settings, client),
         true <- Client.canonical_task_page?(current_task, source_id) or {:error, :notion_noncanonical_bound_task},
         {:ok, blocker} <- fetch_page(blocker_page_id, source_id, settings, client),
         true <- Client.canonical_task_page?(blocker, source_id) or {:error, :notion_noncanonical_blocker},
         {:ok, existing_ids} <- blocked_by_page_ids(current_task, current_task_id, settings, client),
         relation_ids <- Enum.uniq(existing_ids) do
      update_relation(current_task_id, blocker_page_id, relation_ids, settings, client)
    end
  end

  def add(_, _, _, _, _), do: {:error, :invalid_notion_tool_arguments}

  defp binding_source(%{notion_data_source_id: source}) when is_binary(source) and source != "", do: {:ok, source}
  defp binding_source(_binding), do: {:error, :notion_unbound_task}

  defp bound_page(id, source, settings, client) do
    case client.("GET", "/pages/#{id}", %{}, nil, settings) do
      {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => ^source}} = page} -> {:ok, page}
      {:ok, _page} -> {:error, :notion_out_of_scope_task}
      {:error, _reason} = error -> error
      _ -> {:error, :notion_malformed_provider_response}
    end
  end

  defp fetch_page(id, source, settings, client) do
    case client.("GET", "/pages/#{id}", %{}, nil, settings) do
      {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => ^source}} = page} -> {:ok, page}
      {:ok, _} -> {:error, :notion_out_of_scope_blocker}
      {:error, _reason} = error -> error
      _ -> {:error, :notion_malformed_provider_response}
    end
  end

  defp blocked_by_page_ids(%{"properties" => properties}, page_id, settings, client) when is_map(properties) do
    relation = properties["Blocked By"]

    with {:ok, direct_ids} <- relation_ids(relation),
         {:ok, expanded_ids} <- expand_relation(relation, page_id, settings, client) do
      {:ok, if(expanded_ids == [], do: direct_ids, else: expanded_ids)}
    end
  end

  defp blocked_by_page_ids(_, _, _, _), do: {:error, :notion_malformed_task_relation}

  defp relation_ids(%{"type" => "relation", "relation" => values}) when is_list(values) do
    values
    |> Enum.reduce_while({:ok, []}, fn value, {:ok, acc} ->
      case relation_page_id(value) do
        id when is_binary(id) -> {:cont, {:ok, [id | acc]}}
        _ -> {:halt, {:error, :notion_malformed_task_relation}}
      end
    end)
    |> reverse_ok()
  end

  defp relation_ids(_), do: {:error, :notion_malformed_task_relation}

  defp expand_relation(%{"has_more" => true, "id" => property_id}, page_id, settings, client)
       when is_binary(property_id),
       do: property_relation_ids(page_id, property_id, settings, client, nil, [])

  defp expand_relation(%{"has_more" => value}, _page_id, _settings, _client) when value not in [false, nil],
    do: {:error, :notion_malformed_task_relation}

  defp expand_relation(_relation, _page_id, _settings, _client), do: {:ok, []}

  defp property_relation_ids(page_id, property_id, settings, client, cursor, acc) do
    params = if cursor, do: %{"start_cursor" => cursor}, else: %{}

    case client.("GET", "/pages/#{page_id}/properties/#{property_id}", params, nil, settings) do
      {:ok, %{"results" => results, "has_more" => false}} when is_list(results) ->
        relation_values(results, acc)

      {:ok, %{"results" => results, "has_more" => true, "next_cursor" => next_cursor}}
      when is_list(results) and is_binary(next_cursor) ->
        with {:ok, ids} <- relation_values(results, acc),
             {:ok, more} <- property_relation_ids(page_id, property_id, settings, client, next_cursor, []) do
          {:ok, ids ++ more}
        end

      {:error, _reason} = error ->
        error

      _ ->
        {:error, :notion_pagination_integrity_failure}
    end
  end

  defp relation_values(values, acc) do
    Enum.reduce_while(values, {:ok, acc}, fn value, {:ok, ids} ->
      case relation_page_id(value) do
        id when is_binary(id) -> {:cont, {:ok, [id | ids]}}
        _ -> {:halt, {:error, :notion_malformed_task_relation}}
      end
    end)
    |> reverse_ok()
  end

  defp update_relation(current_task_id, blocker_page_id, existing_ids, settings, client) do
    if blocker_page_id in existing_ids do
      {:ok, %{"current_task_page_id" => current_task_id, "blocker_page_id" => blocker_page_id, "added" => false, "blocked_by_page_ids" => existing_ids}}
    else
      relation = Enum.map(existing_ids ++ [blocker_page_id], &%{"id" => &1})

      case client.(
             "PATCH",
             "/pages/#{current_task_id}",
             %{},
             %{"properties" => %{"Blocked By" => %{"relation" => relation}}},
             settings
           ) do
        {:ok, _response} ->
          {:ok, %{"current_task_page_id" => current_task_id, "blocker_page_id" => blocker_page_id, "added" => true, "blocked_by_page_ids" => existing_ids ++ [blocker_page_id]}}

        {:error, _reason} = error ->
          error

        _ ->
          {:error, :notion_malformed_provider_response}
      end
    end
  end

  defp relation_page_id(%{"relation" => %{"id" => id}}) when is_binary(id), do: id
  defp relation_page_id(%{"id" => id}) when is_binary(id), do: id
  defp relation_page_id(_), do: nil
  defp reverse_ok({:ok, values}), do: {:ok, Enum.reverse(values)}
  defp reverse_ok(error), do: error
end
