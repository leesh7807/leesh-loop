defmodule SymphonyElixir.ExecutionHistoryTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.ExecutionHistory

  setup do
    path = Path.join(System.tmp_dir!(), "symphony-executions-#{System.unique_integer([:positive])}.json")
    on_exit(fn -> File.rm(path) end)
    {:ok, path: path}
  end

  test "persists updates by execution identity and reads them after a new process starts", %{path: path} do
    initial = execution("execution-1", "2026-09-27T10:00:00Z", "running")
    assert :ok = ExecutionHistory.upsert(path, initial, 20)

    updated = %{initial | worker_host: "worker-a", workspace_path: "/workspaces/PLAN-1", session_id: "thread-1", turn_count: 2, tokens: %{input_tokens: 10, output_tokens: 20, total_tokens: 30}}
    assert :ok = ExecutionHistory.upsert(path, updated, 20)

    assert {:ok, [persisted]} = ExecutionHistory.list(path, "PLAN-1")
    assert persisted.execution_id == "execution-1"
    assert persisted.issue_id == "issue-1"
    assert persisted.attempt == 2
    assert persisted.worker_host == "worker-a"
    assert persisted.workspace_path == "/workspaces/PLAN-1"
    assert persisted.session_id == "thread-1"
    assert persisted.turn_count == 2
    assert persisted.tokens == %{input_tokens: 10, output_tokens: 20, total_tokens: 30}
  end

  test "retention evicts old terminal executions while preserving active executions", %{path: path} do
    active = execution("active", "2026-09-27T09:00:00Z", "running")
    assert :ok = ExecutionHistory.upsert(path, active, 1)
    assert :ok = ExecutionHistory.upsert(path, execution("old", "2026-09-27T09:01:00Z", "completed"), 1)
    assert :ok = ExecutionHistory.upsert(path, execution("new", "2026-09-27T09:02:00Z", "completed"), 1)

    assert {:ok, records} = ExecutionHistory.list(path)
    assert Enum.map(records, & &1.execution_id) == ["active", "new"]
  end

  test "restart reconciliation marks stale attempts and bounds repeated interruptions", %{path: path} do
    for attempt <- 1..6 do
      record = execution("interrupted-#{attempt}", "2026-09-27T10:0#{attempt}:00Z", "running")
      assert :ok = ExecutionHistory.upsert(path, record, 20)
    end

    assert :ok = ExecutionHistory.reconcile(path, 2, DateTime.utc_now())

    assert {:ok, records} = ExecutionHistory.list(path)
    assert length(records) == 2
    assert Enum.all?(records, &(&1.status == "interrupted"))
    assert Enum.all?(records, &(&1.result == "process_restarted"))
    assert Enum.all?(records, &is_nil(&1.ended_at))
    assert Enum.all?(records, &is_nil(&1.runtime_seconds))
  end

  test "orchestrator restart preserves completed history and reconciles a persisted active execution", %{path: path} do
    task_supervisor = Module.concat(__MODULE__, :RestartExecutionTaskSupervisor)
    orchestrator = Module.concat(__MODULE__, :RestartExecutionOrchestrator)
    start_supervised!({Task.Supervisor, name: task_supervisor})

    active = execution("interrupted-at-restart", "2026-09-27T10:00:00Z", "running")
    completed = execution("completed-before-restart", "2026-09-27T09:00:00Z", "completed")
    assert :ok = ExecutionHistory.upsert(path, active, 20)
    assert :ok = ExecutionHistory.upsert(path, completed, 20)

    {:ok, first_pid} =
      Orchestrator.start_link(
        name: orchestrator,
        task_supervisor: task_supervisor,
        execution_history_path: path
      )

    assert {:ok, first_read} = Orchestrator.execution_history(orchestrator, nil, 15_000)
    assert Enum.find(first_read, &(&1.execution_id == "interrupted-at-restart")).status == "interrupted"
    assert Enum.find(first_read, &(&1.execution_id == "completed-before-restart")).status == "completed"
    assert :ok = GenServer.stop(first_pid)

    {:ok, second_pid} =
      Orchestrator.start_link(
        name: orchestrator,
        task_supervisor: task_supervisor,
        execution_history_path: path
      )

    on_exit(fn ->
      if Process.alive?(second_pid), do: Process.exit(second_pid, :shutdown)
    end)

    assert {:ok, second_read} = Orchestrator.execution_history(orchestrator, nil, 15_000)
    interrupted = Enum.find(second_read, &(&1.execution_id == "interrupted-at-restart"))
    persisted_completion = Enum.find(second_read, &(&1.execution_id == "completed-before-restart"))

    assert interrupted.status == "interrupted"
    assert interrupted.result == "process_restarted"
    assert is_nil(interrupted.ended_at)
    assert is_nil(interrupted.runtime_seconds)
    assert persisted_completion.status == "completed"
    assert persisted_completion.ended_at == completed.ended_at
  end

  test "invalid retention leaves the previous history record intact", %{path: path} do
    record = execution("stable", "2026-09-27T10:00:00Z", "completed")
    assert :ok = ExecutionHistory.upsert(path, record, 10)
    previous = File.read!(path)

    assert {:error, :invalid_retention} = ExecutionHistory.upsert(path, execution("later", "2026-09-27T11:00:00Z", "completed"), 0)
    assert File.read!(path) == previous
    assert {:ok, [%{execution_id: "stable"}]} = ExecutionHistory.list(path)
  end

  test "orchestrator updates and completes the same execution through its structured reader", %{path: path} do
    task_supervisor = Module.concat(__MODULE__, :ExecutionTaskSupervisor)
    orchestrator = Module.concat(__MODULE__, :ExecutionOrchestrator)
    start_supervised!({Task.Supervisor, name: task_supervisor})

    {:ok, orchestrator_pid} =
      Orchestrator.start_link(
        name: orchestrator,
        task_supervisor: task_supervisor,
        execution_history_path: path
      )

    on_exit(fn ->
      if Process.alive?(orchestrator_pid), do: Process.exit(orchestrator_pid, :shutdown)
    end)

    issue = %Issue{
      id: "issue-telemetry",
      identifier: "PLAN-TELEMETRY",
      title: "Execution telemetry",
      state: "In Progress",
      url: "https://example.test/PLAN-TELEMETRY"
    }

    {:ok, worker_pid} = Task.Supervisor.start_child(task_supervisor, fn -> Process.sleep(:infinity) end)
    monitor_ref = Process.monitor(worker_pid)
    started_at = DateTime.utc_now()

    running_entry = %{
      pid: worker_pid,
      ref: monitor_ref,
      execution_id: "execution-telemetry",
      identifier: issue.identifier,
      issue: issue,
      worker_host: nil,
      workspace_path: nil,
      session_id: nil,
      turn_count: 0,
      retry_attempt: 3,
      codex_input_tokens: 0,
      codex_output_tokens: 0,
      codex_total_tokens: 0,
      codex_last_reported_input_tokens: 0,
      codex_last_reported_output_tokens: 0,
      codex_last_reported_total_tokens: 0,
      started_at: started_at
    }

    :sys.replace_state(orchestrator_pid, fn state ->
      Map.put(state, :running, %{issue.id => running_entry})
    end)

    send(orchestrator_pid, {:worker_runtime_info, issue.id, %{worker_host: "worker-a", workspace_path: "/workspaces/PLAN-TELEMETRY"}})
    send(orchestrator_pid, {:codex_worker_update, issue.id, %{event: :session_started, session_id: "thread-telemetry", timestamp: DateTime.utc_now()}})

    send(
      orchestrator_pid,
      {:codex_worker_update, issue.id,
       %{
         event: :notification,
         payload: %{"method" => "thread/tokenUsage/updated", "params" => %{"tokenUsage" => %{"total" => %{"inputTokens" => 12, "outputTokens" => 4, "totalTokens" => 16}}}},
         timestamp: DateTime.utc_now()
       }}
    )

    assert {:ok, [active]} = Orchestrator.execution_history(orchestrator, issue.identifier, 15_000)
    assert active.status == "running"
    assert active.execution_id == "execution-telemetry"
    assert active.attempt == 3
    assert active.started_at == DateTime.to_iso8601(started_at)
    assert active.worker_host == "worker-a"
    assert active.workspace_path == "/workspaces/PLAN-TELEMETRY"
    assert active.session_id == "thread-telemetry"
    assert active.turn_count == 1
    assert active.tokens == %{input_tokens: 12, output_tokens: 4, total_tokens: 16}

    Process.exit(worker_pid, :kill)
    assert_receive {:DOWN, ^monitor_ref, :process, ^worker_pid, :killed}
    send(orchestrator_pid, {:DOWN, monitor_ref, :process, worker_pid, :killed})

    assert wait_for_termination(orchestrator, issue.identifier, 50)
  end

  defp execution(id, started_at, status) do
    %{
      execution_id: id,
      issue_id: "issue-1",
      issue_identifier: "PLAN-1",
      issue_url: "https://example.test/PLAN-1",
      attempt: 2,
      status: status,
      started_at: started_at,
      ended_at: if(status == "running", do: nil, else: "2026-09-27T10:01:00Z"),
      result: nil,
      reason: nil,
      worker_host: nil,
      workspace_path: nil,
      session_id: nil,
      turn_count: 0,
      tokens: %{input_tokens: 0, output_tokens: 0, total_tokens: 0},
      runtime_seconds: nil
    }
  end

  defp wait_for_termination(_orchestrator, _identifier, 0), do: false

  defp wait_for_termination(orchestrator, identifier, attempts) do
    case Orchestrator.execution_history(orchestrator, identifier, 15_000) do
      {:ok, [%{status: "terminated", result: "abnormal_exit", ended_at: ended_at, runtime_seconds: runtime} = execution]} ->
        is_binary(ended_at) and is_integer(runtime) and
          execution.session_id == "thread-telemetry" and execution.turn_count == 1 and
          execution.tokens == %{input_tokens: 12, output_tokens: 4, total_tokens: 16}

      _ ->
        Process.sleep(10)
        wait_for_termination(orchestrator, identifier, attempts - 1)
    end
  end
end
