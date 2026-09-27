defmodule SymphonyElixir.ExecutionHistory do
  @moduledoc """
  Atomic, bounded persistence for structured Worker Execution history.

  The Orchestrator is the sole writer. This module owns encoding, interrupted-record
  reconciliation, retention, and the file replacement boundary.
  """

  @schema_version 1
  @record_fields [
    :execution_id,
    :issue_id,
    :issue_identifier,
    :issue_url,
    :attempt,
    :status,
    :started_at,
    :ended_at,
    :result,
    :reason,
    :worker_host,
    :workspace_path,
    :session_id,
    :turn_count,
    :tokens,
    :runtime_seconds
  ]

  @spec default_path() :: Path.t()
  def default_path do
    case Application.get_env(:symphony_elixir, :execution_history_file) do
      path when is_binary(path) ->
        Path.expand(path)

      _ ->
        log_file = Application.get_env(:symphony_elixir, :log_file, SymphonyElixir.LogFile.default_log_file())
        Path.join(Path.dirname(log_file), "execution-history.json")
    end
  end

  @spec list(Path.t()) :: {:ok, [map()]} | {:error, term()}
  def list(path) when is_binary(path) do
    with {:ok, records} <- read_records(path) do
      {:ok, records}
    end
  end

  @spec list(Path.t(), String.t() | nil) :: {:ok, [map()]} | {:error, term()}
  def list(path, issue_identifier) when is_binary(path) do
    with {:ok, records} <- list(path) do
      filtered =
        if is_binary(issue_identifier) do
          Enum.filter(records, &(&1.issue_identifier == issue_identifier))
        else
          records
        end

      {:ok, filtered}
    end
  end

  @spec upsert(Path.t(), map(), pos_integer()) :: :ok | {:error, term()}
  def upsert(path, record, retention) when is_binary(path) and is_map(record) do
    with :ok <- validate_retention(retention),
         {:ok, records} <- read_records(path) do
      records = Enum.reject(records, &(&1.execution_id == record.execution_id))
      write_records(path, retain([record | records], retention))
    end
  end

  @spec reconcile(Path.t(), pos_integer(), DateTime.t()) :: :ok | {:error, term()}
  def reconcile(path, retention, _now)
      when is_binary(path) and is_integer(retention) and retention > 0 do
    with {:ok, records} <- read_records(path) do
      records =
        Enum.map(records, fn
          %{status: "running"} = record ->
            %{record | status: "interrupted", result: "process_restarted", reason: "worker was no longer active when Symphony restarted"}

          record ->
            record
        end)

      write_records(path, retain(records, retention))
    end
  end

  @spec cleanup(Path.t(), pos_integer()) :: :ok | {:error, term()}
  def cleanup(path, retention) when is_binary(path) do
    with :ok <- validate_retention(retention),
         {:ok, records} <- read_records(path) do
      write_records(path, retain(records, retention))
    end
  end

  defp validate_retention(retention) when is_integer(retention) and retention > 0, do: :ok
  defp validate_retention(_retention), do: {:error, :invalid_retention}

  defp read_records(path) do
    case File.read(path) do
      {:ok, contents} -> decode_records(contents)
      {:error, :enoent} -> {:ok, []}
      {:error, reason} -> {:error, {:read_failed, reason}}
    end
  end

  defp decode_records(contents) do
    with {:ok, %{"schema_version" => @schema_version, "executions" => records}}
         when is_list(records) <- Jason.decode(contents) do
      records
      |> Enum.reduce_while({:ok, []}, fn record, {:ok, acc} ->
        case decode_record(record) do
          {:ok, decoded} -> {:cont, {:ok, [decoded | acc]}}
          {:error, reason} -> {:halt, {:error, {:invalid_record, reason}}}
        end
      end)
      |> case do
        {:ok, decoded} -> {:ok, Enum.reverse(decoded)}
        error -> error
      end
    else
      {:ok, _} -> {:error, :unsupported_schema}
      {:error, reason} -> {:error, {:invalid_json, reason}}
    end
  end

  defp decode_record(record) when is_map(record) do
    decoded = Map.new(@record_fields, fn field -> {field, Map.get(record, Atom.to_string(field))} end)

    if is_binary(decoded.execution_id) and is_binary(decoded.issue_identifier) and
         is_binary(decoded.started_at) and is_binary(decoded.status) and is_map(decoded.tokens) do
      {:ok, %{decoded | tokens: decode_tokens(decoded.tokens)}}
    else
      {:error, :missing_required_fields}
    end
  end

  defp decode_record(_record), do: {:error, :not_a_map}

  defp decode_tokens(tokens) do
    Map.new([:input_tokens, :output_tokens, :total_tokens], fn key ->
      {key, Map.get(tokens, Atom.to_string(key), 0)}
    end)
  end

  defp retain(records, retention) do
    {active, inactive} = Enum.split_with(records, &(&1.status == "running"))

    retained_inactive =
      inactive
      |> Enum.sort_by(& &1.started_at, :desc)
      |> Enum.take(retention)

    (active ++ retained_inactive)
    |> Enum.sort_by(& &1.started_at)
  end

  defp write_records(_path, []), do: :ok

  defp write_records(path, records) do
    directory = Path.dirname(path)
    temporary = path <> ".#{Ecto.UUID.generate()}.tmp"
    contents = Jason.encode!(%{schema_version: @schema_version, executions: records}, pretty: true) <> "\n"

    with :ok <- File.mkdir_p(directory),
         :ok <- write_synced(temporary, contents),
         :ok <- File.chmod(temporary, 0o600),
         :ok <- File.rename(temporary, path) do
      :ok
    else
      {:error, reason} ->
        _ = File.rm(temporary)
        {:error, {:write_failed, reason}}
    end
  end

  defp write_synced(path, contents) do
    with {:ok, file} <- File.open(path, [:write, :binary, :exclusive]) do
      result =
        with :ok <- IO.binwrite(file, contents),
             :ok <- :file.sync(file) do
          :ok
        end

      close_result = File.close(file)

      case {result, close_result} do
        {:ok, :ok} -> :ok
        {{:error, reason}, _} -> {:error, reason}
        {_, {:error, reason}} -> {:error, reason}
      end
    end
  end
end
