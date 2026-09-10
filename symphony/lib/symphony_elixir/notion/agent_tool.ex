defmodule SymphonyElixir.Notion.AgentTool do
  @moduledoc """No Notion mutation tool is exposed until the workflow contracts one."""

  @spec tool_specs() :: [map()]
  def tool_specs, do: []

  @spec execute(String.t() | nil, term(), keyword()) :: map()
  def execute(tool, _arguments, _opts) do
    output =
      Jason.encode!(%{
        "error" => %{
          "message" => "Unsupported dynamic tool: #{inspect(tool)}.",
          "supportedTools" => []
        }
      })

    %{
      "success" => false,
      "output" => output,
      "contentItems" => [%{"type" => "inputText", "text" => output}]
    }
  end
end
