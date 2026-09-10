defmodule SymphonyElixir.Notion.Adapter do
  @moduledoc """Notion tracker adapter for the Publisher-managed execution surface."""
  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.Notion.{AgentTool, Client}
  alias SymphonyElixir.Tracker.Issue

  @impl true
  def validate_config(settings), do: Client.validate_settings(settings)

  @impl true
  def fetch_issues_by_states(states), do: client_module().fetch_issues_by_states(states)

  @impl true
  def fetch_issues_by_ids(ids), do: client_module().fetch_issues_by_ids(ids)

  @impl true
  def agent_tool_specs, do: AgentTool.tool_specs()

  @impl true
  def execute_agent_tool(tool, arguments, opts), do: AgentTool.execute(tool, arguments, opts)

  @impl true
  def secret_environment_names(settings), do: Client.secret_environment_names(settings)

  defp client_module, do: Application.get_env(:symphony_elixir, :notion_client_module, Client)
end
