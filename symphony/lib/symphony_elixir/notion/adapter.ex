defmodule SymphonyElixir.Notion.Adapter do
  @moduledoc "Notion tracker adapter for the canonical task data-source surface."

  @behaviour SymphonyElixir.Tracker
  alias SymphonyElixir.Notion.{AgentTool, Client}
  alias SymphonyElixir.Tracker.Issue

  @spec validate_config(map()) :: :ok | {:error, term()}
  def validate_config(settings) do
    with :ok <- Client.validate_settings(settings),
         :ok <- states(settings.active_states, :missing_notion_active_states),
         :ok <- states(settings.terminal_states, :missing_notion_terminal_states),
         do: :ok
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: Client.fetch_issues_by_states(states)

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids), do: Client.fetch_issues_by_ids(ids)

  @spec agent_tool_specs() :: [map()]
  def agent_tool_specs, do: AgentTool.tool_specs()

  @spec execute_agent_tool(String.t(), term(), keyword()) :: map()
  def execute_agent_tool(tool, arguments, opts), do: AgentTool.execute(tool, arguments, opts)

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(settings), do: Client.secret_environment_names(settings)

  @spec bind_session(map(), Issue.t() | map() | nil) :: map()
  def bind_session(binding, %Issue{id: id}) when is_binary(id) do
    case Client.resolve_task_data_source(binding.tracker_settings) do
      {:ok, source_id} -> Map.merge(binding, %{notion_data_source_id: source_id, notion_issue_id: id})
      {:error, reason} -> Map.put(binding, :notion_binding_error, reason)
    end
  end

  def bind_session(binding, _issue), do: binding

  defp states(states, _missing) when is_list(states) and states != [] do
    if Enum.all?(states, &(is_binary(&1) and String.trim(&1) != "")), do: :ok, else: {:error, :invalid_notion_states}
  end

  defp states(_, missing), do: {:error, missing}
end
