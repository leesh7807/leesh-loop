defmodule SymphonyElixir.Notion.AgentTool do
  @moduledoc "Task-local, capability-limited Notion worker tools."
  alias SymphonyElixir.Notion.Client

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec("notion_task_read", "Read the currently bound Notion task.", %{}),
      spec("notion_task_comments", "Read all comments on the currently bound Notion task.", %{}),
      spec("notion_task_set_state", "Set State on the currently bound Notion task.", %{"state" => %{"type" => "string"}}, ["state"]),
      spec("notion_task_append_workpad", "Append text to the canonical Workpad of the currently bound task.", %{"text" => %{"type" => "string"}}, ["text"])
    ]
  end

  @spec execute(String.t(), term(), keyword()) :: map()
  def execute(tool, arguments, opts) do
    run(tool, arguments, opts)
  end

  defp run(tool, arguments, opts) do
    settings = Keyword.fetch!(opts, :tracker_settings)
    # The session binding is passed in opts by Tracker; old generic adapters only receive settings.
    binding = Keyword.get(opts, :tracker_binding, %{})
    issue = if binding[:notion_issue_id], do: %{id: binding.notion_issue_id}, else: Keyword.get(opts, :issue)
    client = Keyword.get(opts, :notion_request, &Client.request/5)

    case {tool, issue_id(issue)} do
      {_, nil} ->
        failure(:notion_unbound_task)

      {"notion_task_read", id} ->
        scoped(id, binding, settings, client, fn -> client.("GET", "/pages/#{id}", %{}, nil, settings) end) |> respond()

      {"notion_task_comments", id} ->
        scoped(id, binding, settings, client, fn -> comments(id, settings, client, nil, []) end) |> respond()

      {"notion_task_set_state", id} ->
        with {:ok, state} <- string_arg(arguments, "state"),
             {:ok, value} <-
               scoped(id, binding, settings, client, fn ->
                 client.(
                   "PATCH",
                   "/pages/#{id}",
                   %{},
                   %{
                     "properties" => %{"State" => %{"select" => %{"name" => state}}}
                   },
                   settings
                 )
               end) do
          respond({:ok, value})
        else
          error -> failure(error)
        end

      {"notion_task_append_workpad", id} ->
        with {:ok, text} <- string_arg(arguments, "text"), {:ok, workpad} <- scoped(id, binding, settings, client, fn -> workpad(id, settings, client) end) do
          respond(
            client.(
              "PATCH",
              "/blocks/#{workpad}/children",
              %{},
              %{"children" => [%{"object" => "block", "type" => "paragraph", "paragraph" => %{"rich_text" => [%{"type" => "text", "text" => %{"content" => text}}]}}]},
              settings
            )
          )
        else
          e -> failure(e)
        end

      _ ->
        failure(:unsupported_notion_tool)
    end
  end

  defp comments(id, settings, client, cursor, acc) do
    with {:ok, payload} <- client.("GET", "/comments", comment_query(id, cursor), nil, settings), %{"results" => results, "has_more" => more} <- payload do
      if more and is_binary(payload["next_cursor"]),
        do: comments(id, settings, client, payload["next_cursor"], acc ++ results),
        else: if(more, do: {:error, :notion_pagination_integrity_failure}, else: {:ok, acc ++ results})
    else
      {:error, _} = e -> e
      _ -> {:error, :notion_malformed_provider_response}
    end
  end

  defp workpad(id, settings, client) do
    with {:ok, blocks} <- task_children(id, settings, client, nil, []),
         [block] <- Enum.filter(blocks, &(get_in(&1, ["child_page", "title"]) == "Workpad")) do
      {:ok, block["id"]}
    else
      _ -> {:error, :notion_malformed_task_representation}
    end
  end

  defp task_children(id, settings, client, cursor, acc) do
    with {:ok, %{"results" => results, "has_more" => more} = payload} <-
           client.("GET", "/blocks/#{id}/children", cursor_query(id, cursor), nil, settings) do
      cond do
        more and is_binary(payload["next_cursor"]) ->
          task_children(id, settings, client, payload["next_cursor"], acc ++ results)

        more ->
          {:error, :notion_pagination_integrity_failure}

        true ->
          {:ok, acc ++ results}
      end
    else
      {:error, _} = error -> error
      _ -> {:error, :notion_malformed_provider_response}
    end
  end

  defp issue_id(%{id: id}) when is_binary(id), do: id
  defp issue_id(_), do: nil

  defp scoped(id, %{notion_data_source_id: source}, settings, client, fun) do
    with {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => ^source}}} <- client.("GET", "/pages/#{id}", %{}, nil, settings), do: fun.()
  end

  defp scoped(_, _, _, _, _), do: {:error, :notion_unbound_task}

  defp string_arg(%{} = args, key) do
    case args[key] do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, :invalid_notion_tool_arguments}
    end
  end

  defp string_arg(_, _), do: {:error, :invalid_notion_tool_arguments}
  defp cursor_query(_id, nil), do: %{"page_size" => 100}
  defp cursor_query(id, cursor), do: Map.put(cursor_query(id, nil), "start_cursor", cursor)
  defp comment_query(id, nil), do: %{"block_id" => id, "page_size" => 100}
  defp comment_query(id, cursor), do: Map.put(comment_query(id, nil), "start_cursor", cursor)
  defp respond({:ok, body}), do: output(true, body)
  defp respond({:error, reason}), do: failure(reason)
  defp failure(reason), do: output(false, %{"error" => %{"message" => inspect(reason)}})

  defp output(success, body) do
    text = Jason.encode!(body, pretty: true)
    %{"success" => success, "output" => text, "contentItems" => [%{"type" => "inputText", "text" => text}]}
  end

  defp spec(name, description, properties, required \\ []),
    do: %{"name" => name, "description" => description, "inputSchema" => %{"type" => "object", "additionalProperties" => false, "properties" => properties, "required" => required}}
end
