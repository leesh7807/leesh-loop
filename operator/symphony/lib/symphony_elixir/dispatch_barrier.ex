defmodule SymphonyElixir.DispatchBarrier do
  @moduledoc false
  use GenServer

  @check_interval_ms 100

  def start_link(opts \\ []), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  def subscribe(pid) do
    case Process.whereis(__MODULE__) do
      nil ->
        send(pid, :dispatch_authorized)
        :ok

      _barrier ->
        GenServer.call(__MODULE__, {:subscribe, pid})
    end
  end

  def status do
    case Process.whereis(__MODULE__) do
      nil -> true
      _barrier -> GenServer.call(__MODULE__, :status)
    end
  end

  @impl true
  def init(_opts) do
    state = %{enabled?: System.get_env("SYMPHONY_DISPATCH_BARRIER") != "closed", subscribers: MapSet.new()}
    if state.enabled?, do: write_acknowledgement()
    schedule_check(state)
    {:ok, state}
  end

  @impl true
  def handle_call({:subscribe, pid}, _from, state) do
    if state.enabled?, do: send(pid, :dispatch_authorized)
    {:reply, :ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
  end

  def handle_call(:status, _from, state), do: {:reply, state.enabled?, state}

  @impl true
  def handle_info(:check_authorization, %{enabled?: false} = state) do
    state = if authorized?(), do: enable(state), else: state
    schedule_check(state)
    {:noreply, state}
  end

  def handle_info(:check_authorization, state), do: {:noreply, state}

  defp enable(state) do
    write_acknowledgement()
    Enum.each(state.subscribers, &send(&1, :dispatch_authorized))
    %{state | enabled?: true}
  end

  defp authorized? do
    with path when is_binary(path) <- System.get_env("SYMPHONY_DISPATCH_AUTHORIZATION_FILE"),
         {:ok, raw} <- File.read(path),
         {:ok, %{"state" => "running", "runtime_id" => runtime_id}} <- Jason.decode(raw),
         ^runtime_id <- System.get_env("SYMPHONY_RUNTIME_ID") do
      true
    else
      _ -> false
    end
  end

  defp write_acknowledgement do
    with path when is_binary(path) <- System.get_env("SYMPHONY_DISPATCH_ACK_FILE"),
         runtime_id when is_binary(runtime_id) <- System.get_env("SYMPHONY_RUNTIME_ID") do
      pid = :os.getpid() |> to_string() |> String.to_integer()
      temporary = path <> "." <> Integer.to_string(pid) <> ".tmp"
      File.mkdir_p!(Path.dirname(path))
      File.write!(temporary, Jason.encode!(%{"runtime_id" => runtime_id, "pid" => pid, "dispatch_capable" => true}))
      File.rename!(temporary, path)
    else
      _ -> :ok
    end
  end

  defp schedule_check(%{enabled?: false}), do: Process.send_after(self(), :check_authorization, @check_interval_ms)
  defp schedule_check(_state), do: :ok
end
