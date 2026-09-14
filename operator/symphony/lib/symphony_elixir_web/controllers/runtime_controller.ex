defmodule SymphonyElixirWeb.RuntimeController do
  use Phoenix.Controller, formats: [:json]

  def show(conn, _params) do
    json(conn, %{pid: :os.getpid(), runtime_id: System.get_env("SYMPHONY_RUNTIME_ID"), dispatch_capable: SymphonyElixir.DispatchBarrier.status()})
  end
end
