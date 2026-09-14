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
        read_task(id, binding, settings, client)

      {"notion_task_comments", id} ->
        scoped(id, binding, settings, client, fn -> comments(id, settings, client, nil, []) end) |> respond()

      {"notion_task_set_state", id} ->
        set_state(id, arguments, binding, settings, client)

      {"notion_task_append_workpad", id} ->
        append_workpad_tool(id, arguments, binding, settings, client)

      _ ->
        failure(:unsupported_notion_tool)
    end
  end

  defp read_task(id, binding, settings, client) do
    scoped(id, binding, settings, client, fn -> client.("GET", "/pages/#{id}", %{}, nil, settings) end)
    |> respond()
  end

  defp set_state(id, arguments, binding, settings, client) do
    with {:ok, state} <- string_arg(arguments, "state"),
         {:ok, value} <-
           scoped(id, binding, settings, client, fn ->
             client.(
               "PATCH",
               "/pages/#{id}",
               %{},
               %{
                 "properties" => %{
                   "State" => %{
                     "rich_text" => [%{"type" => "text", "text" => %{"content" => state}}]
                   }
                 }
               },
               settings
             )
           end) do
      respond({:ok, value})
    else
      error -> failure(error)
    end
  end

  defp append_workpad(id, text, settings, client) do
    body = %{
      "children" => [
        %{
          "object" => "block",
          "type" => "paragraph",
          "paragraph" => %{
            "rich_text" => [%{"type" => "text", "text" => %{"content" => text}}]
          }
        }
      ]
    }

    client.("PATCH", "/blocks/#{id}/children", %{}, body, settings)
    |> respond()
  end

  defp append_workpad_tool(id, arguments, binding, settings, client) do
    with {:ok, text} <- string_arg(arguments, "text"),
         {:ok, _task} <- scoped(id, binding, settings, client, fn -> {:ok, id} end) do
      append_workpad(id, text, settings, client)
    else
      error -> failure(error)
    end
  end

  defp comments(id, settings, client, cursor, acc) do
    case client.("GET", "/comments", comment_query(id, cursor), nil, settings) do
      {:ok, %{"results" => results, "has_more" => more} = payload}
      when is_list(results) and is_boolean(more) ->
        paginate_comments(id, settings, client, payload, more, results, acc)

      {:error, _} = error ->
        error

      _ ->
        {:error, :notion_malformed_provider_response}
    end
  end

  defp paginate_comments(id, settings, client, payload, true, results, acc) do
    case payload["next_cursor"] do
      cursor when is_binary(cursor) -> comments(id, settings, client, cursor, acc ++ results)
      _ -> {:error, :notion_pagination_integrity_failure}
    end
  end

  defp paginate_comments(_id, _settings, _client, _payload, false, results, acc), do: {:ok, acc ++ results}

  defp issue_id(%{id: id}) when is_binary(id), do: id
  defp issue_id(_), do: nil

  defp scoped(id, %{notion_data_source_id: source}, settings, client, fun) do
    case client.("GET", "/pages/#{id}", %{}, nil, settings) do
      {:ok, %{"parent" => %{"type" => "data_source_id", "data_source_id" => ^source}}} ->
        fun.()

      {:error, _} = error ->
        error

      _ ->
        {:error, :notion_out_of_scope_task}
    end
  end

  defp scoped(_, _, _, _, _), do: {:error, :notion_unbound_task}

  defp string_arg(%{} = args, key) do
    case args[key] do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, :invalid_notion_tool_arguments}
    end
  end

  defp string_arg(_, _), do: {:error, :invalid_notion_tool_arguments}
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
