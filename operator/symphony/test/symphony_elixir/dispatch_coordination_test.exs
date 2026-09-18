defmodule SymphonyElixir.DispatchCoordinationTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.DispatchCoordination

  test "the scheduler and Operator share an exclusive identifier lock" do
    root = Path.join(System.tmp_dir!(), "dispatch-coordination-#{System.unique_integer([:positive])}")
    previous = System.get_env("SYMPHONY_DISPATCH_COORDINATION_ROOT")
    System.put_env("SYMPHONY_DISPATCH_COORDINATION_ROOT", root)

    on_exit(fn ->
      if previous, do: System.put_env("SYMPHONY_DISPATCH_COORDINATION_ROOT", previous), else: System.delete_env("SYMPHONY_DISPATCH_COORDINATION_ROOT")
      File.rm_rf!(root)
    end)

    assert {:ok, :held} =
             DispatchCoordination.with_lock("SELF-1", fn ->
               assert {:busy, _path} = DispatchCoordination.with_lock("SELF-1", fn -> :not_allowed end)
               :held
             end)

    assert {:ok, :reacquired} = DispatchCoordination.with_lock("SELF-1", fn -> :reacquired end)
  end

  test "a dead lock owner is recoverable" do
    root = Path.join(System.tmp_dir!(), "dispatch-coordination-#{System.unique_integer([:positive])}")
    previous = System.get_env("SYMPHONY_DISPATCH_COORDINATION_ROOT")
    System.put_env("SYMPHONY_DISPATCH_COORDINATION_ROOT", root)
    File.mkdir_p!(root)
    digest = :crypto.hash(:sha256, "SELF-2") |> Base.encode16(case: :lower)
    path = Path.join(root, digest <> ".lock")
    File.write!(path, Jason.encode!(%{pid: 999_999, started_at: DateTime.utc_now()}))

    on_exit(fn ->
      if previous, do: System.put_env("SYMPHONY_DISPATCH_COORDINATION_ROOT", previous), else: System.delete_env("SYMPHONY_DISPATCH_COORDINATION_ROOT")
      File.rm_rf!(root)
    end)

    assert {:ok, :recovered} = DispatchCoordination.with_lock("SELF-2", fn -> :recovered end)
  end
end
