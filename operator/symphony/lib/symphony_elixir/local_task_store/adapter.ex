defmodule SymphonyElixir.LocalTaskStore.Adapter do
  @moduledoc "Symphony read adapter for the selected Loop instance's Local Task Store."

  @behaviour SymphonyElixir.Tracker

  alias SymphonyElixir.LocalTaskStore.{AgentTool, Client}
  alias SymphonyElixir.Tracker.Issue

  @spec validate_config(map()) :: :ok | {:error, term()}
  def validate_config(settings), do: Client.validate_settings(settings)

  @spec fetch_issues_by_states([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_states(states) when is_list(states) do
    settings = SymphonyElixir.Config.settings!().tracker

    with {:ok, tasks} <- Client.run("list_tasks", %{"states" => states, "terminalStates" => settings.terminal_states}) do
      normalize_tasks(tasks)
    end
  end

  @spec fetch_issues_by_ids([String.t()]) :: {:ok, [Issue.t()]} | {:error, term()}
  def fetch_issues_by_ids(ids) when is_list(ids) do
    settings = SymphonyElixir.Config.settings!().tracker

    with {:ok, tasks} <- Client.run("get_tasks", %{"ids" => Enum.uniq(ids), "terminalStates" => settings.terminal_states}),
         {:ok, issues} <- normalize_tasks(tasks),
         :ok <- unique_identifiers(issues) do
      {:ok, issues}
    end
  end

  @spec agent_tool_specs() :: [map()]
  def agent_tool_specs, do: AgentTool.tool_specs()

  @spec execute_agent_tool(String.t(), term(), keyword()) :: map()
  def execute_agent_tool(tool, arguments, opts), do: AgentTool.execute(tool, arguments, opts)

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(settings), do: Client.secret_environment_names(settings)

  @spec bind_session(map(), Issue.t() | map() | nil) :: map()
  def bind_session(binding, %Issue{id: task_id}) when is_binary(task_id),
    do: Map.put(binding, :local_task_id, task_id)

  def bind_session(binding, _issue), do: binding

  defp normalize_tasks(tasks) when is_list(tasks) do
    issues = Enum.map(tasks, &to_issue/1)
    if Enum.any?(issues, &is_nil/1), do: {:error, :local_task_store_malformed_task}, else: {:ok, issues}
  end

  defp normalize_tasks(_tasks), do: {:error, :local_task_store_malformed_response}

  defp to_issue(
         %{
           "id" => id,
           "identifier" => identifier,
           "title" => title,
           "state" => state,
           "dispatchable" => dispatchable
         } = task
       )
       when is_binary(id) and is_binary(identifier) and is_binary(title) and is_binary(state) and
              is_boolean(dispatchable) do
    %Issue{
      id: id,
      native_ref: %{task_id: id},
      identifier: identifier,
      title: title,
      description: task["acceptedPlan"],
      priority: task["priority"],
      state: state,
      blocked_by: task["blockedBy"] || [],
      labels: task["labels"] || [],
      dispatchable: dispatchable,
      created_at: datetime(task["createdAt"]),
      updated_at: datetime(task["updatedAt"])
    }
  end

  defp to_issue(_task), do: nil

  defp unique_identifiers(issues) do
    identifiers = MapSet.new(issues, & &1.identifier)
    if length(issues) == MapSet.size(identifiers), do: :ok, else: {:error, :local_task_store_identity_invariant_violation}
  end

  defp datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, date_time, _offset} -> date_time
      _ -> nil
    end
  end

  defp datetime(_value), do: nil
end
