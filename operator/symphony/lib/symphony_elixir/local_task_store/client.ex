defmodule SymphonyElixir.LocalTaskStore.Client do
  @moduledoc "Host-side command boundary for the selected Loop instance's SQLite Task Store."

  require Logger

  @store_path_environment "LEESH_LOOP_LOCAL_TASK_STORE_PATH"
  @runtime_root_environment "LEESH_LOOP_RUNTIME_ROOT"

  @spec validate_settings(map()) :: :ok | {:error, term()}
  def validate_settings(settings) do
    with :ok <- configured_states(settings.active_states, :missing_local_active_states),
         :ok <- configured_states(settings.terminal_states, :missing_local_terminal_states),
         {:ok, _path} <- database_path(),
         {:ok, _cli} <- cli_path() do
      :ok
    end
  end

  @spec secret_environment_names(map()) :: [String.t()]
  def secret_environment_names(_settings), do: [@store_path_environment, @runtime_root_environment]

  @spec run(String.t(), map()) :: {:ok, term()} | {:error, term()}
  def run(operation, input) when is_binary(operation) and is_map(input) do
    with {:ok, cli} <- cli_path(),
         {:ok, _path} <- database_path() do
      execute(cli, operation, input)
    end
  end

  defp execute(cli, operation, input) do
    case System.cmd("node", [cli, operation, Jason.encode!(input)], stderr_to_stdout: true) do
      {output, 0} -> decode_result(output, operation)
      {output, status} -> operation_failure(operation, status, output)
    end
  rescue
    error in [ErlangError, Jason.EncodeError] ->
      operation_failure(operation, :command_error, Exception.message(error))
  end

  defp decode_result(output, operation) do
    case Jason.decode(output) do
      {:ok, %{"ok" => true, "result" => result}} -> {:ok, result}
      {:ok, %{"ok" => false, "error" => error}} -> operation_failure(operation, :store_error, error)
      {:ok, _} -> operation_failure(operation, :invalid_response, output)
      {:error, reason} -> operation_failure(operation, {:invalid_json, reason}, output)
    end
  end

  defp operation_failure(operation, status, detail) do
    Logger.warning("Local Task Store operation failed operation=#{operation} status=#{inspect(status)} detail=#{String.slice(to_string(detail), 0, 500)}")
    {:error, {:local_task_store_operation_failed, operation, status}}
  end

  defp database_path do
    case System.get_env(@store_path_environment) do
      path when is_binary(path) and path != "" ->
        if Path.type(path) == :absolute and File.regular?(path), do: {:ok, path}, else: {:error, :local_task_store_unavailable}

      _ ->
        {:error, :local_task_store_path_not_configured}
    end
  end

  defp cli_path do
    case System.get_env(@runtime_root_environment) do
      root when is_binary(root) and root != "" ->
        path = Path.join(root, "operator/local_task_store/src/local-task-store-cli.mjs")
        if File.regular?(path), do: {:ok, path}, else: {:error, :local_task_store_cli_not_found}

      _ ->
        {:error, :local_task_store_runtime_root_not_configured}
    end
  end

  defp configured_states(states, _missing) when is_list(states) and states != [] do
    if Enum.all?(states, &(is_binary(&1) and String.trim(&1) != "")), do: :ok, else: {:error, :invalid_local_task_states}
  end

  defp configured_states(_states, missing), do: {:error, missing}
end
