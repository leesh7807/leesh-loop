defmodule SymphonyElixirWeb.RuntimeController do
  use Phoenix.Controller, formats: [:json]

  def show(conn, _params) do
    json(conn, %{
      pid: os_pid(),
      runtime_id: System.get_env("SYMPHONY_RUNTIME_ID"),
      dispatch_capable: SymphonyElixir.DispatchBarrier.status(),
      lifecycle_evidence: SymphonyElixir.LifecycleEvidence.status()
    })
  end

  defp os_pid, do: :os.getpid() |> to_string() |> String.to_integer()
end
