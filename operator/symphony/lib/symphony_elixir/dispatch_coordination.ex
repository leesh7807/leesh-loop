defmodule SymphonyElixir.DispatchCoordination do
  @moduledoc """
  Coordinates scheduler dispatch with the production Operator's stranded-task closure.

  The lock is only a production coordination primitive. Tracker state and Symphony
  remain the lifecycle authorities; the lock prevents a fence/read/terminal sequence
  from racing a final scheduler refresh/spawn sequence.
  """

  @stale_marker_ms 100

  @spec with_lock(String.t(), (-> term())) :: {:ok, term()} | {:busy, String.t()} | {:error, term()}
  def with_lock(identifier, operation) when is_binary(identifier) and is_function(operation, 0) do
    case System.get_env("SYMPHONY_DISPATCH_COORDINATION_ROOT") do
      root when is_binary(root) and root != "" ->
        File.mkdir_p(root)
        path = lock_path(root, identifier)

        case acquire(path) do
          {:ok, :lock} ->
            try do
              {:ok, operation.()}
            after
              File.rm_rf(path)
            end

          :busy ->
            {:busy, path}

          {:error, reason} ->
            {:error, reason}
        end

      _ ->
        {:ok, operation.()}
    end
  end

  defp lock_path(root, identifier) do
    digest = :crypto.hash(:sha256, identifier) |> Base.encode16(case: :lower)
    Path.join(root, digest <> ".lock")
  end

  defp acquire(path) do
    candidate = "#{path}.candidate-#{:os.getpid()}-#{System.unique_integer([:positive])}"

    with :ok <- write_candidate(candidate),
         # The candidate is fully written before this no-replace atomic claim.
         result <- File.ln(candidate, path) do
      File.rm(candidate)

      case result do
        :ok -> {:ok, :lock}
        {:error, :eexist} -> reclaim_stale(path)
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp write_candidate(path) do
    pid = :os.getpid() |> to_string() |> String.to_integer()

    case File.open(path, [:write, :exclusive]) do
      {:ok, device} ->
        try do
          :ok = IO.write(device, Jason.encode!(%{pid: pid, started_at: DateTime.utc_now()}))
          :file.sync(device)
        after
          File.close(device)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp reclaim_stale(path) do
    case read_owner(path) do
      {:ok, contents} ->
        case Jason.decode(contents) do
          {:ok, %{"pid" => pid}} when is_integer(pid) ->
            if process_alive?(pid) do
              :busy
            else
              remove_and_retry(path)
            end

          _ ->
            reclaim_unowned(path)
        end

      {:error, :enoent} ->
        acquire(path)

      {:error, _reason} ->
        reclaim_unowned(path)
    end
  end

  defp read_owner(path) do
    case File.read(path) do
      {:error, :eisdir} -> File.read(Path.join(path, "owner.json"))
      result -> result
    end
  end

  defp reclaim_unowned(path) do
    case File.stat(path) do
      {:ok, %{mtime: mtime}} ->
        age_ms = NaiveDateTime.diff(NaiveDateTime.utc_now(), NaiveDateTime.from_erl!(mtime), :millisecond)

        if age_ms > @stale_marker_ms do
          remove_and_retry(path)
        else
          :busy
        end

      {:error, :enoent} ->
        acquire(path)

      {:error, _reason} ->
        :busy
    end
  end

  defp remove_and_retry(path) do
    reclaim_path = "#{path}.reclaim-#{System.unique_integer([:positive])}"

    case File.rename(path, reclaim_path) do
      :ok ->
        File.rm_rf(reclaim_path)
        acquire(path)

      {:error, :enoent} ->
        acquire(path)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp process_alive?(pid) when is_integer(pid) and pid > 0 do
    File.exists?("/proc/#{pid}")
  end

  defp process_alive?(_pid), do: false
end
