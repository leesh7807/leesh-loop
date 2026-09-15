defmodule SymphonyElixir.Notion.AgentTool do
  @moduledoc "Task-local, capability-limited Notion worker tools."
  alias SymphonyElixir.Notion.Client

  @max_text_chunk_length 2_000
  @max_rich_text_items 100
  @max_child_blocks 100
  @max_request_payload_bytes 500_000

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec("notion_task_read", "Read the currently bound Notion task.", %{}),
      spec("notion_task_read_workpad", "Read the complete canonical Workpad of the currently bound Notion task in provider order.", %{}),
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

      {"notion_task_read_workpad", id} ->
        read_workpad(id, binding, settings, client)

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

  defp read_workpad(id, binding, settings, client) do
    case scoped(id, binding, settings, client, fn -> workpad_blocks(id, settings, client, nil, []) end) do
      {:ok, blocks} -> respond({:ok, %{"blocks" => blocks}})
      {:error, reason} -> workpad_read_failure(reason)
    end
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
                  "State" => %{"select" => %{"name" => state}}
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
    batches = text |> text_chunks() |> paragraph_blocks() |> request_batches()
    append_batches(id, batches, settings, client)
  end

  defp text_chunks(text) do
    text_chunks(text, [])
  end

  defp text_chunks(<<>>, chunks), do: Enum.reverse(chunks)

  defp text_chunks(text, chunks) do
    {chunk, rest} = take_codepoints(text, @max_text_chunk_length, [])
    text_chunks(rest, [chunk | chunks])
  end

  defp take_codepoints(text, 0, codepoints),
    do: {IO.iodata_to_binary(Enum.reverse(codepoints)), text}

  defp take_codepoints(<<>>, _remaining, codepoints),
    do: {IO.iodata_to_binary(Enum.reverse(codepoints)), <<>>}

  defp take_codepoints(text, remaining, codepoints) do
    {codepoint, rest} = String.next_codepoint(text)
    take_codepoints(rest, remaining - 1, [codepoint | codepoints])
  end

  defp paragraph_blocks(chunks), do: paragraph_blocks(chunks, [])

  defp paragraph_blocks([], blocks), do: Enum.reverse(blocks)

  defp paragraph_blocks(chunks, blocks) do
    {candidate, rest} = Enum.split(chunks, @max_rich_text_items)
    fitting_count = largest_fitting_prefix(candidate)
    {paragraph_chunks, remaining} = Enum.split(candidate, fitting_count)
    paragraph_blocks(remaining ++ rest, [paragraph_block(paragraph_chunks) | blocks])
  end

  defp largest_fitting_prefix(chunks), do: largest_fitting_prefix(chunks, 1, length(chunks), 1)

  defp largest_fitting_prefix(_chunks, low, high, best) when low > high, do: best

  defp largest_fitting_prefix(chunks, low, high, best) do
    midpoint = div(low + high, 2)
    candidate = Enum.take(chunks, midpoint)

    if payload_size([paragraph_block(candidate)]) <= @max_request_payload_bytes do
      largest_fitting_prefix(chunks, midpoint + 1, high, midpoint)
    else
      largest_fitting_prefix(chunks, low, midpoint - 1, best)
    end
  end

  defp paragraph_block(chunks) do
    %{
      "object" => "block",
      "type" => "paragraph",
      "paragraph" => %{
        "rich_text" => Enum.map(chunks, &%{"type" => "text", "text" => %{"content" => &1}})
      }
    }
  end

  defp request_batches(blocks), do: request_batches(blocks, [], [])

  defp request_batches([], [], batches), do: Enum.reverse(batches)
  defp request_batches([], current, batches), do: Enum.reverse([current | batches])

  defp request_batches([block | rest], [], batches),
    do: request_batches(rest, [block], batches)

  defp request_batches([block | rest], current, batches) do
    candidate = current ++ [block]

    if length(candidate) <= @max_child_blocks and payload_size(candidate) <= @max_request_payload_bytes do
      request_batches(rest, candidate, batches)
    else
      request_batches(rest, [block], [current | batches])
    end
  end

  defp payload_size(blocks), do: Jason.encode!(%{"children" => blocks}) |> byte_size()

  defp append_batches(id, batches, settings, client) do
    total = length(batches)
    append_batches(id, batches, settings, client, 0, total)
  end

  defp append_batches(_id, [], _settings, _client, acknowledged, total),
    do: respond({:ok, %{"outcome" => "complete", "acknowledged_batch_count" => acknowledged, "total_batch_count" => total}})

  defp append_batches(id, [blocks | rest], settings, client, acknowledged, total) do
    body = %{"children" => blocks}

    case client.("PATCH", "/blocks/#{id}/children", %{}, body, settings) do
      {:ok, _response} ->
        append_batches(id, rest, settings, client, acknowledged + 1, total)

      {:error, reason} ->
        append_failure(reason, acknowledged, total, acknowledged + 1)

      response ->
        append_failure(
          {:notion_unexpected_provider_response, response},
          acknowledged,
          total,
          acknowledged + 1
        )
    end
  end

  defp append_failure(reason, acknowledged, total, failed_batch) do
    ambiguous = ambiguous_provider_error?(reason)

    outcome =
      cond do
        ambiguous -> "ambiguous_provider_outcome"
        acknowledged == 0 -> "failed_before_acknowledgement"
        true -> "partial_append"
      end

    error = %{
      "type" => "notion_workpad_append_failure",
      "outcome" => outcome,
      "acknowledged_batch_count" => acknowledged,
      "total_batch_count" => total,
      "failed_batch_index" => failed_batch,
      "provider_error" => provider_error_details(reason)
    }

    error =
      if ambiguous do
        Map.merge(error, %{
          "failed_batch_durable_effect" => "unknown",
          "retry_suffix" => "unknown"
        })
      else
        error
      end

    output(false, %{"error" => error})
  end

  defp ambiguous_provider_error?({:notion_transport_failure, _reason}), do: true
  defp ambiguous_provider_error?({:notion_provider_response, status, _body}) when status >= 500, do: true
  defp ambiguous_provider_error?({:transport_failure, _reason}), do: true
  defp ambiguous_provider_error?(:timeout), do: true
  defp ambiguous_provider_error?(:closed), do: true
  defp ambiguous_provider_error?(:econnreset), do: true
  defp ambiguous_provider_error?(_reason), do: false

  defp provider_error_details({:notion_provider_response, status, body}) do
    %{"kind" => "notion_provider_response", "status" => status, "body" => json_safe(body)}
  end

  defp provider_error_details({:notion_transport_failure, reason}) do
    %{"kind" => "notion_transport_failure", "reason" => inspect(reason)}
  end

  defp provider_error_details(reason) when is_atom(reason) do
    %{"kind" => "notion_error", "reason" => Atom.to_string(reason)}
  end

  defp provider_error_details(reason), do: %{"kind" => "notion_error", "reason" => inspect(reason)}

  defp json_safe(value) when is_map(value) do
    Map.new(value, fn {key, nested} -> {json_key(key), json_safe(nested)} end)
  end

  defp json_safe(value) when is_list(value), do: Enum.map(value, &json_safe/1)
  defp json_safe(value) when is_tuple(value), do: inspect(value)
  defp json_safe(value) when is_atom(value) and value not in [nil, true, false], do: Atom.to_string(value)
  defp json_safe(value), do: value

  defp json_key(key) when is_binary(key), do: key
  defp json_key(key) when is_atom(key), do: Atom.to_string(key)
  defp json_key(key), do: inspect(key)

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

  defp workpad_blocks(id, settings, client, cursor, acc) do
    case client.("GET", "/blocks/#{id}/children", block_query(cursor), nil, settings) do
      {:ok, %{"results" => results, "has_more" => more} = payload}
      when is_list(results) and is_boolean(more) ->
        case {more, payload["next_cursor"]} do
          {false, _} -> {:ok, acc ++ results}
          {true, next_cursor} when is_binary(next_cursor) -> workpad_blocks(id, settings, client, next_cursor, acc ++ results)
          {true, _} -> {:error, :notion_pagination_integrity_failure}
        end

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
  defp block_query(nil), do: %{"page_size" => 100}
  defp block_query(cursor), do: Map.put(block_query(nil), "start_cursor", cursor)
  defp respond({:ok, body}), do: output(true, body)
  defp respond({:error, reason}), do: failure(reason)
  defp failure(reason), do: output(false, %{"error" => %{"message" => inspect(reason)}})

  defp workpad_read_failure(reason) do
    output(false, %{"error" => %{"type" => "notion_workpad_read_failure", "reason" => provider_error_details(reason)}})
  end

  defp output(success, body) do
    text = Jason.encode!(body, pretty: true)
    %{"success" => success, "output" => text, "contentItems" => [%{"type" => "inputText", "text" => text}]}
  end

  defp spec(name, description, properties, required \\ []),
    do: %{"name" => name, "description" => description, "inputSchema" => %{"type" => "object", "additionalProperties" => false, "properties" => properties, "required" => required}}
end
