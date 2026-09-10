defmodule SymphonyElixir.Notion.Adapter do
  @moduledoc """
  Notion execution-surface reader. It translates the Publisher-owned task
  representation without adding scheduler or lifecycle policy.
  """

  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Notion.{AgentTool, Client}
  alias SymphonyElixir.Tracker.Issue

  @spec validate_config(map()) :: :ok | {:error, term()}
  def validate_config(tracker_settings) do
    with :ok <- validate_states(tracker_settings.active_states, :missing_notion_active_states),
         :ok <- validate_states(tracker_settings.terminal_states, :missing_notion_terminal_states) do
      Client.validate_settings(tracker_settings)
    end
  end

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states), do: client_module().fetch_issues_by_states(states)

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids), do: client_module().fetch_issues_by_ids(ids)

  @spec agent_tool_specs() :: [map()]
  def agent_tool_specs, do: AgentTool.tool_specs()

  @spec execute_agent_tool(String.t(), term(), keyword()) :: map()
  def execute_agent_tool(tool, arguments, opts), do: AgentTool.execute(tool, arguments, opts)

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(tracker_settings), do: Client.secret_environment_names(tracker_settings)

  defp client_module, do: Application.get_env(:symphony_elixir, :notion_client_module, Client)

  defp validate_states(states, _error) when is_list(states) and states != [] do
    if Enum.all?(states, &(is_binary(&1) and String.trim(&1) != "")), do: :ok, else: {:error, :invalid_notion_states}
  end

  defp validate_states(_states, error), do: {:error, error}
end
