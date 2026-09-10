defmodule SymphonyElixir.Notion.AgentTool do
  @moduledoc """
  Narrow, provider-oriented Notion operations for a bound Symphony session.
  """

  alias SymphonyElixir.Notion.Client

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec("notion_read_page", ["page_id"], "Read one Notion page."),
      spec("notion_read_comments", ["page_id"], "Read one page of comments for a Notion page; pass next_cursor to continue."),
      spec("notion_update_page", ["page_id", "properties"], "Update represented values on one Notion page."),
      spec("notion_append_blocks", ["page_id", "children"], "Append content blocks to one Notion page.")
    ]
  end

  @spec execute(String.t() | nil, term(), keyword()) :: map()
  def execute(tool, arguments, opts) do
    with {:ok, method, path, params, body} <- operation(tool, arguments),
         {:ok, %{status: status, body: response}} <- client(opts).(method, path, params, body, Keyword.take(opts, [:tracker_settings])),
         true <- is_integer(status) do
      response(status in 200..299, %{"status" => status, "body" => response})
    else
      {:error, reason} -> response(false, %{"error" => %{"message" => "Notion tool request failed.", "reason" => inspect(reason)}})
      _ -> response(false, %{"error" => %{"message" => "Notion tool returned a malformed response."}})
    end
  end

  defp spec(name, required, description) do
    %{
      "name" => name,
      "description" => description,
      "inputSchema" => %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => required,
        "properties" => %{"page_id" => %{"type" => "string"}, "next_cursor" => %{"type" => "string"}, "properties" => %{"type" => "object"}, "children" => %{"type" => "array"}}
      }
    }
  end

  defp operation("notion_read_page", %{"page_id" => id}) when is_binary(id), do: {:ok, "GET", "/pages/#{id}", %{}, nil}

  defp operation("notion_read_comments", %{"page_id" => id} = arguments) when is_binary(id) do
    params = %{"block_id" => id, "page_size" => 100}

    case Map.get(arguments, "next_cursor") do
      nil -> {:ok, "GET", "/comments", params, nil}
      cursor when is_binary(cursor) and cursor != "" -> {:ok, "GET", "/comments", Map.put(params, "start_cursor", cursor), nil}
      _ -> {:error, :invalid_notion_comment_cursor}
    end
  end

  defp operation("notion_update_page", %{"page_id" => id, "properties" => properties}) when is_binary(id) and is_map(properties), do: {:ok, "PATCH", "/pages/#{id}", %{}, %{"properties" => properties}}

  defp operation("notion_append_blocks", %{"page_id" => id, "children" => children}) when is_binary(id) and is_list(children),
    do: {:ok, "PATCH", "/blocks/#{id}/children", %{}, %{"children" => children}}

  defp operation(tool, _), do: {:error, {:unsupported_or_invalid_notion_operation, tool}}
  defp client(opts), do: Keyword.get(opts, :notion_client, &Client.request/5)

  defp response(success, payload) do
    output = Jason.encode!(payload)
    %{"success" => success, "output" => output, "contentItems" => [%{"type" => "inputText", "text" => output}]}
  end
end
