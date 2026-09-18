defmodule SymphonyElixir.DispatchCoordination do
  @moduledoc """
  Coordinates scheduler dispatch with the production Operator's stranded-task closure.

  The lock is only a production coordination primitive. Tracker state and Symphony
  remain the lifecycle authorities; the lock prevents a fence/read/terminal sequence
  from racing a final scheduler refresh/spawn sequence.
  """

  @flock_command System.find_executable("flock") || "/usr/bin/flock"

  @spec with_lock(String.t(), (-> term())) :: {:ok, term()} | {:busy, String.t()} | {:error, term()}
  def with_lock(identifier, operation) when is_binary(identifier) and is_function(operation, 0) do
    case System.get_env("SYMPHONY_DISPATCH_COORDINATION_ROOT") do
      root when is_binary(root) and root != "" ->
        File.mkdir_p(root)
        path = lock_path(root, identifier)

        case acquire(path) do
          {:ok, port} ->
            try do
              {:ok, operation.()}
            after
              release(port)
            end

          {:busy, busy_path} ->
            {:busy, busy_path}

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
    port = Port.open({:spawn_executable, @flock_command}, [:binary, :exit_status, {:args, ["-n", path, "/bin/sh", "-c", "printf ready; IFS= read -r _"]}])
    await_acquire(port, path)
  end

  defp await_acquire(port, path) do
    receive do
      {^port, {:data, data}} ->
        if String.contains?(data, "ready"), do: {:ok, port}, else: await_acquire(port, path)

      {^port, {:exit_status, 1}} ->
        {:busy, path}

      {^port, {:exit_status, status}} ->
        {:error, {:flock_exit, status}}
    end
  end

  defp release(port) do
    Port.command(port, "\n")

    receive do
      {^port, {:exit_status, _status}} -> :ok
    after
      1_000 -> Port.close(port)
    end
  end
end
