defmodule SymphonyElixir.LocalTaskStoreAdapterTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.LocalTaskStore.{Adapter, AgentTool}
  alias SymphonyElixir.Tracker.Issue

  @source_root Path.expand("../../../..", __DIR__)
  @store_cli Path.join(@source_root, "operator/local_task_store/src/local-task-store-cli.mjs")
  @store_module Path.join(@source_root, "operator/local_task_store/src/local-task-store.mjs")

  test "Local Adapter uses Symphony states and terminal Blocked By meaning" do
    root = Path.join(System.tmp_dir!(), "symphony-local-store-adapter-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    database = Path.join(root, "tasks.sqlite")
    setup_local_runtime(database, root)

    tasks = seed_tasks(database)

    assert :ok = Adapter.validate_config(Config.settings!().tracker)
    assert {:ok, issues} = Adapter.fetch_issues_by_states(["Ready", "In Progress"])
    assert MapSet.new(Enum.map(issues, & &1.id)) == MapSet.new([tasks["blocker"], tasks["blocked"], tasks["backlog"]])

    blocked = Enum.find(issues, &(&1.id == tasks["blocked"]))
    backlog = Enum.find(issues, &(&1.id == tasks["backlog"]))
    assert blocked.state == "Ready"
    refute blocked.dispatchable
    assert [%{"id" => blocker_id, "terminal" => false}] = blocked.blocked_by
    assert blocker_id == tasks["blocker"]
    assert backlog.state == "In Progress"

    set_task_state(tasks["blocker"], "Done")
    assert {:ok, [refreshed]} = Adapter.fetch_issues_by_ids([tasks["blocked"]])
    assert refreshed.dispatchable
    assert [%{"id" => ^blocker_id, "terminal" => true}] = refreshed.blocked_by
    assert {:ok, []} = Adapter.fetch_issues_by_states(["Backlog"])

    File.rm_rf!(root)
  end

  test "bound Local Worker tools read task input and append only to the selected task" do
    root = Path.join(System.tmp_dir!(), "symphony-local-store-tools-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    database = Path.join(root, "tasks.sqlite")
    setup_local_runtime(database, root)
    tasks = seed_tasks(database)
    binding = %{local_task_id: tasks["blocked"]}

    assert Enum.map(Adapter.agent_tool_specs(), & &1["name"]) == [
             "local_task_read",
             "local_task_read_workpad",
             "local_task_comments",
             "local_task_set_state",
             "local_task_append_workpad",
             "local_task_update",
             "local_task_publish_plan",
             "local_task_add_blocked_by"
           ]

    task = call_tool("local_task_read", %{}, binding)
    assert task["id"] == tasks["blocked"]
    assert task["acceptedPlan"] == "# blocked\nAccepted Local input.\n"
    assert task["state"] == "Ready"
    assert task["blockedBy"] == [%{"id" => tasks["blocker"], "terminal" => false}]

    assert [%{"content" => "A user supplied comment."}] = call_tool("local_task_comments", %{}, binding)["comments"]
    assert call_tool("local_task_read_workpad", %{}, binding)["records"] == []

    appended = call_tool("local_task_append_workpad", %{"text" => "Worker read the Accepted Plan."}, binding)
    assert appended["taskId"] == tasks["blocked"]
    assert [%{"content" => "Worker read the Accepted Plan."}] = call_tool("local_task_read_workpad", %{}, binding)["records"]

    updated = call_tool("local_task_update", %{"title" => "Updated local title", "priority" => 4, "labels" => ["local"]}, binding)
    assert updated["title"] == "Updated local title"
    assert updated["priority"] == 4
    assert updated["labels"] == ["local"]
    assert call_tool("local_task_set_state", %{"state" => "In Progress"}, binding)["state"] == "In Progress"

    added = call_tool("local_task_add_blocked_by", %{"blocker_task_id" => tasks["second_blocker"]}, binding)
    assert MapSet.new(added["blockedBy"]) == MapSet.new([tasks["blocker"], tasks["second_blocker"]])
    assert call_tool("local_task_read", %{}, binding)["acceptedPlan"] == "# blocked\nAccepted Local input.\n"

    publication = call_tool("local_task_publish_plan", %{"plan" => "# follow-up\nPublished from the Worker tool.\n"}, binding)
    assert publication["state"] == "Backlog"
    assert publication["page_id"] != tasks["blocked"]

    assert Adapter.bind_session(%{}, %Issue{id: tasks["blocked"]}) == %{local_task_id: tasks["blocked"]}
    assert call_tool("local_task_read", %{"task_id" => tasks["blocker"]}, binding)["id"] == tasks["blocked"]
    refute call_tool_result("local_task_update", %{"acceptedPlan" => "rewritten"}, binding)["success"]

    File.rm_rf!(root)
  end

  defp setup_local_runtime(database, runtime_root) do
    previous = %{
      "LEESH_LOOP_LOCAL_TASK_STORE_PATH" => System.get_env("LEESH_LOOP_LOCAL_TASK_STORE_PATH"),
      "LEESH_LOOP_RUNTIME_ROOT" => System.get_env("LEESH_LOOP_RUNTIME_ROOT")
    }

    System.put_env("LEESH_LOOP_LOCAL_TASK_STORE_PATH", database)
    System.put_env("LEESH_LOOP_RUNTIME_ROOT", @source_root)

    on_exit(fn ->
      Enum.each(previous, fn {key, value} -> restore_env(key, value) end)
      File.rm_rf(runtime_root)
    end)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "local",
      tracker_endpoint: nil,
      tracker_api_token: nil,
      tracker_active_states: ["Ready", "In Progress"],
      tracker_terminal_states: ["Done", "Cancelled"]
    )
  end

  defp seed_tasks(database) do
    script = """
    import { pathToFileURL } from 'node:url';
    const module = await import(pathToFileURL(process.argv[1]));
    const store = await module.openLocalTaskStore(process.argv[2]);
    const blocker = store.publishTask({publicationKey:'local-blocker',identifier:'PLAN-LOCALBLOCKER',title:'Blocker',state:'Ready',acceptedPlan:'# blocker\\nReady blocker.\\n'});
    const second = store.publishTask({publicationKey:'local-second-blocker',identifier:'PLAN-LOCALSECOND',title:'Second blocker',state:'Done',acceptedPlan:'# second-blocker\\nDone blocker.\\n'});
    const blocked = store.publishTask({publicationKey:'local-blocked',identifier:'PLAN-LOCALBLOCKED',title:'Blocked task',state:'Ready',blockedBy:[blocker.id],acceptedPlan:'# blocked\\nAccepted Local input.\\n'});
    const backlog = store.publishTask({publicationKey:'local-backlog',identifier:'PLAN-LOCALBACKLOG',title:'In progress task',state:'In Progress',acceptedPlan:'# in-progress\\nActive task.\\n'});
    store.appendComment(blocked.id, 'A user supplied comment.');
    process.stdout.write(JSON.stringify({blocker:blocker.id,second_blocker:second.id,blocked:blocked.id,backlog:backlog.id}));
    store.close();
    """

    {output, 0} = System.cmd("node", ["-e", script, @store_module, database], stderr_to_stdout: true)
    Jason.decode!(output)
  end

  defp set_task_state(task_id, state) do
    {output, 0} = System.cmd("node", [@store_cli, "set_state", Jason.encode!(%{"taskId" => task_id, "state" => state})], env: local_env())
    Jason.decode!(output)
  end

  defp local_env do
    [
      {"LEESH_LOOP_LOCAL_TASK_STORE_PATH", System.get_env("LEESH_LOOP_LOCAL_TASK_STORE_PATH")},
      {"LEESH_LOOP_RUNTIME_ROOT", @source_root}
    ]
  end

  defp call_tool(name, arguments, binding) do
    result = call_tool_result(name, arguments, binding)
    assert result["success"], result["output"]
    Jason.decode!(result["output"])
  end

  defp call_tool_result(name, arguments, binding) do
    AgentTool.execute(name, arguments, tracker_binding: binding)
  end
end
