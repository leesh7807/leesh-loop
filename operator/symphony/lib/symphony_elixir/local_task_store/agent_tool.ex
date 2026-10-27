defmodule SymphonyElixir.LocalTaskStore.AgentTool do
  @moduledoc "Task-scoped Local Task Store tools exposed through Symphony's existing Worker boundary."

  alias SymphonyElixir.LocalTaskStore.Client

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec("local_task_read", "Read the currently bound Local Task, including its Accepted Plan and Blocked By relations.", %{}),
      spec("local_task_read_workpad", "Read ordered Workpad records for the currently bound Local Task.", %{}),
      spec("local_task_comments", "Read user comments for the currently bound Local Task.", %{}),
      spec("local_task_set_state", "Set State on the currently bound Local Task.", %{"state" => %{"type" => "string"}}, ["state"]),
      spec("local_task_append_workpad", "Append text to the currently bound Local Task Workpad.", %{"text" => %{"type" => "string"}}, ["text"]),
      spec("local_task_update", "Update mutable properties on the currently bound Local Task.", %{
        "title" => %{"type" => "string"},
        "priority" => %{"type" => ["integer", "null"]},
        "labels" => %{"type" => "array", "items" => %{"type" => "string"}}
      }),
      spec("local_task_publish_plan", "Publish a complete Plan to the same Local Task Store as a new Ready task.", %{"plan" => %{"type" => "string"}}, ["plan"]),
      spec("local_task_add_blocked_by", "Add a task ID to the Blocked By relation of the currently bound Local Task.", %{"blocker_task_id" => %{"type" => "string"}}, ["blocker_task_id"])
    ]
  end

  @spec execute(String.t(), term(), keyword()) :: map()
  def execute(tool, arguments, opts), do: run(tool, arguments, opts)

  defp run(tool, arguments, opts) do
    binding = Keyword.get(opts, :tracker_binding, %{})

    case binding[:local_task_id] || issue_id(Keyword.get(opts, :issue)) do
      task_id when is_binary(task_id) -> dispatch(tool, task_id, arguments)
      _ -> failure(:local_task_unbound_task)
    end
  end

  defp dispatch("local_task_read", task_id, _arguments) do
    respond(Client.run("get_task", %{"taskId" => task_id}))
  end

  defp dispatch("local_task_read_workpad", task_id, _arguments) do
    case Client.run("list_records", %{"taskId" => task_id, "kind" => "workpad"}) do
      {:ok, records} -> respond({:ok, %{"records" => records}})
      error -> failure(error)
    end
  end

  defp dispatch("local_task_comments", task_id, _arguments) do
    case Client.run("list_records", %{"taskId" => task_id, "kind" => "comment"}) do
      {:ok, records} -> respond({:ok, %{"comments" => records}})
      error -> failure(error)
    end
  end

  defp dispatch("local_task_set_state", task_id, arguments) do
    with {:ok, state} <- exact_string_arg(arguments, "state"),
         result <- Client.run("set_state", %{"taskId" => task_id, "state" => state}) do
      respond(result)
    else
      error -> failure(error)
    end
  end

  defp dispatch("local_task_append_workpad", task_id, arguments) do
    with {:ok, content} <- exact_string_arg(arguments, "text"),
         result <- Client.run("append_workpad", %{"taskId" => task_id, "content" => content}) do
      respond(result)
    else
      error -> failure(error)
    end
  end

  defp dispatch("local_task_update", task_id, arguments) do
    with {:ok, changes} <- update_arguments(arguments),
         result <- Client.run("update_task", %{"taskId" => task_id, "changes" => changes}) do
      respond(result)
    else
      error -> failure(error)
    end
  end

  defp dispatch("local_task_publish_plan", _task_id, arguments) do
    case exact_string_arg(arguments, "plan") do
      {:ok, plan} -> respond(Client.run("publish_task", %{"plan" => plan, "state" => "Ready", "blockedBy" => []}))
      error -> failure(error)
    end
  end

  defp dispatch("local_task_add_blocked_by", task_id, arguments) do
    case exact_string_arg(arguments, "blocker_task_id") do
      {:ok, blocker_id} -> respond(Client.run("add_blocked_by", %{"taskId" => task_id, "blockerTaskId" => blocker_id}))
      error -> failure(error)
    end
  end

  defp dispatch(_tool, _task_id, _arguments), do: failure(:unsupported_local_task_tool)

  defp update_arguments(%{} = arguments) do
    allowed = ["title", "priority", "labels"]
    keys = Map.keys(arguments)

    if keys != [] and Enum.all?(keys, &(&1 in allowed)), do: {:ok, arguments}, else: {:error, :invalid_local_task_update_arguments}
  end

  defp update_arguments(_arguments), do: {:error, :invalid_local_task_update_arguments}

  defp exact_string_arg(%{} = arguments, key) do
    if Map.keys(arguments) == [key] and is_binary(arguments[key]), do: {:ok, arguments[key]}, else: {:error, :invalid_local_task_tool_arguments}
  end

  defp exact_string_arg(_arguments, _key), do: {:error, :invalid_local_task_tool_arguments}
  defp issue_id(%{id: id}) when is_binary(id), do: id
  defp issue_id(_issue), do: nil
  defp respond({:ok, body}), do: output(true, body)
  defp respond({:error, reason}), do: failure(reason)
  defp failure(reason), do: output(false, %{"error" => %{"message" => inspect(reason)}})

  defp output(success, body) do
    text = Jason.encode!(body, pretty: true)
    %{"success" => success, "output" => text, "contentItems" => [%{"type" => "inputText", "text" => text}]}
  end

  defp spec(name, description, properties, required \\ []),
    do: %{"name" => name, "description" => description, "inputSchema" => %{"type" => "object", "additionalProperties" => false, "properties" => properties, "required" => required}}
end
