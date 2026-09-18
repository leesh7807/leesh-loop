defmodule SymphonyElixir.LifecycleEvidence do
  @moduledoc """
  Best-effort, non-authoritative production lifecycle evidence.

  The writer is deliberately isolated from the scheduler. A slow or failed
  evidence sink can create a collection gap, but it cannot block polling,
  reconciliation, dispatch, retry, or terminal handling.
  """

  use GenServer
  require Logger

  @max_event_bytes 32_000

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @spec record(atom() | String.t(), map()) :: :ok
  def record(kind, fields \\ %{}) when is_map(fields) do
    case Process.whereis(__MODULE__) do
      nil -> :ok
      pid -> GenServer.cast(pid, {:record, kind, fields})
    end

    :ok
  end

  @spec status() :: map()
  def status do
    case Process.whereis(__MODULE__) do
      nil -> %{enabled?: false, written: 0, dropped: 0, error: nil}
      pid -> GenServer.call(pid, :status, 1_000)
    end
  catch
    :exit, _ -> %{enabled?: false, written: 0, dropped: 0, error: :unavailable}
  end

  @impl true
  def init(opts) do
    path = Keyword.get(opts, :path) || System.get_env("SYMPHONY_LIFECYCLE_EVIDENCE_PATH")
    state = %{path: path, written: 0, dropped: 0, error: nil}
    if is_binary(path) and path != "", do: File.mkdir_p(Path.dirname(path))
    {:ok, state}
  end

  @impl true
  def handle_cast({:record, kind, fields}, %{path: path} = state) when is_binary(path) do
    event = %{
      "at" => DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601(),
      "kind" => normalize_kind(kind),
      "runtime_id" => System.get_env("SYMPHONY_RUNTIME_ID"),
      "run_id" => System.get_env("SYMPHONY_SELF_VERIFICATION_RUN_ID"),
      "effective_configured_base" => System.get_env("SYMPHONY_EFFECTIVE_CONFIGURED_BASE_BRANCH"),
      "fields" => fields
    }

    encoded = Jason.encode!(event)

    if byte_size(encoded) > @max_event_bytes do
      {:noreply, %{state | dropped: state.dropped + 1, error: :event_too_large}}
    else
      case File.write(path, encoded <> "\n", [:append]) do
        :ok -> {:noreply, %{state | written: state.written + 1}}
        {:error, reason} -> {:noreply, %{state | dropped: state.dropped + 1, error: reason}}
      end
    end
  end

  def handle_cast({:record, _kind, _fields}, state), do: {:noreply, state}

  @impl true
  def handle_call(:status, _from, state) do
    {:reply, Map.put(state, :enabled?, is_binary(state.path) and state.path != ""), state}
  end

  defp normalize_kind(kind) when is_atom(kind), do: Atom.to_string(kind)
  defp normalize_kind(kind) when is_binary(kind), do: kind
  defp normalize_kind(kind), do: inspect(kind)
end
