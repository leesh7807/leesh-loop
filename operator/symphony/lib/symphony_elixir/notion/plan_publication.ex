defmodule SymphonyElixir.Notion.PlanPublication do
  @moduledoc "Worker-facing publication of a Plan through the canonical Publisher path."

  alias SymphonyElixir.Workflow

  @publisher_relative_path "operator/notion_publisher/dist/src/cli.js"
  @publisher_config_relative_path "operator/notion_publisher/examples/publisher-config.json"
  @publication_state "Backlog"
  @max_command_output 2_000

  @spec publish(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def publish(plan, settings, opts \\ []) when is_binary(plan) do
    runner = Keyword.get(opts, :publisher_runner)

    result =
      if is_function(runner, 2) do
        runner.(plan, settings)
      else
        run_publisher(plan, settings, opts)
      end

    normalize_result(result)
  rescue
    error -> {:error, {:notion_plan_publication_exception, Exception.message(error)}}
  end

  defp run_publisher(plan, settings, opts) do
    with {:ok, %{token: token, database_url: database_url}} <- publication_settings(settings),
         project_root <- Path.dirname(Workflow.workflow_file_path() |> Path.expand()),
         publisher_cli <- Keyword.get(opts, :publisher_cli, Path.join(project_root, @publisher_relative_path)),
         publisher_config <- Keyword.get(opts, :publisher_config, Path.join(project_root, @publisher_config_relative_path)),
         :ok <- require_file(publisher_cli, :publisher_cli),
         :ok <- require_file(publisher_config, :publisher_config),
         {:ok, plan_path} <- write_plan_file(plan) do
      try do
        execute_publisher(project_root, publisher_cli, publisher_config, plan_path, database_url, token)
      after
        File.rm(plan_path)
      end
    end
  end

  defp execute_publisher(project_root, publisher_cli, publisher_config, plan_path, database_url, token) do
    args = [
      publisher_cli,
      "--plan",
      plan_path,
      "--config",
      publisher_config,
      "--database-url",
      database_url,
      "--state",
      @publication_state
    ]

    case System.cmd("node", args,
           cd: project_root,
           env: [{"NOTION_TOKEN", token}],
           stderr_to_stdout: true
         ) do
      {output, 0} -> decode_result(output)
      {output, status} -> {:error, {:notion_plan_publisher_failed, status, truncate(output)}}
    end
  rescue
    error -> {:error, {:notion_plan_publisher_exception, Exception.message(error)}}
  end

  defp decode_result(output) do
    case Jason.decode(String.trim(output)) do
      {:ok, %{"identifier" => identifier, "page_id" => page_id} = result}
      when is_binary(identifier) and is_binary(page_id) ->
        {:ok, result}

      {:ok, _} ->
        {:error, {:notion_plan_publisher_malformed_result, truncate(output)}}

      {:error, reason} ->
        {:error, {:notion_plan_publisher_invalid_output, reason, truncate(output)}}
    end
  end

  defp normalize_result({:ok, %{"identifier" => identifier, "page_id" => page_id} = result})
       when is_binary(identifier) and is_binary(page_id),
       do: {:ok, result}

  defp normalize_result({:ok, result}), do: {:error, {:notion_plan_publisher_malformed_result, result}}
  defp normalize_result({:error, _reason} = error), do: error
  defp normalize_result(result), do: {:error, {:notion_plan_publisher_invalid_runner_result, result}}

  defp publication_settings(%{provider: provider} = settings) when is_map(provider) do
    token = provider["token"] || Map.get(settings, :token)
    database_url = provider["database_url"]

    if is_binary(token) and token != "" and is_binary(database_url) and database_url != "" do
      {:ok, %{token: token, database_url: database_url}}
    else
      {:error, :invalid_notion_publication_configuration}
    end
  end

  defp publication_settings(_settings), do: {:error, :invalid_notion_publication_configuration}

  defp write_plan_file(plan) do
    path = Path.join(System.tmp_dir!(), "leesh-loop-worker-plan-#{System.unique_integer([:positive])}.md")

    case File.write(path, plan, [:binary, :exclusive]) do
      :ok -> {:ok, path}
      {:error, reason} -> {:error, {:notion_plan_file_write_failed, reason}}
    end
  end

  defp require_file(path, kind) do
    if File.regular?(path), do: :ok, else: {:error, {:notion_plan_publisher_file_missing, kind, path}}
  end

  defp truncate(value) when is_binary(value), do: String.slice(value, 0, @max_command_output)
  defp truncate(value), do: inspect(value)
end
