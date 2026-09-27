import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_POLICY } from "../src/core.js";
import { NotionClient } from "../src/notion.js";
import { NotionTaskReader } from "../src/task-reader.js";

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

function task(id: number, state = "Backlog"): any {
  return {
    id: `task-${id}`,
    url: `https://www.notion.so/task-${id}`,
    parent: { type: "data_source_id", data_source_id: "tasks" },
    properties: {
      Title: { type: "title", title: [{ plain_text: `Task ${id}` }] },
      Identifier: { type: "rich_text", rich_text: [{ plain_text: `PLAN-${id}` }] },
      State: { type: "select", select: { name: state } },
      Priority: { type: "number", number: 3 },
      Labels: { type: "multi_select", multi_select: [{ name: "symphony" }] },
      "Blocked By": { id: "blocked-by", type: "relation", relation: [], has_more: false },
      Plan: { type: "relation", relation: [], has_more: false }
    }
  };
}

test("task reader follows Notion cursors and only excludes Cancelled and Publisher Pending", async () => {
  const first = Array.from({ length: 98 }, (_, index) => task(index + 1));
  first.push(task(99, "Cancelled"), task(100, "Publisher Pending"));
  first[0].properties["Blocked By"].relation = [{ id: "task-2" }];
  const second = [task(101, "Human Review"), task(102, "Merging")];
  const taskRequests: any[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/databases/00000000-0000-0000-0000-000000000001") return response({ data_sources: [{ id: "tasks" }, { id: "plans" }] });
    if (url.pathname === "/v1/data_sources/tasks") return response({ id: "tasks", properties: {
      Identifier: { type: "rich_text" }, Title: { type: "title" }, State: { type: "select" }, Priority: { type: "number" }, Labels: { type: "multi_select" },
      "Blocked By": { id: "blocked-by", type: "relation", relation: { data_source_id: "tasks", single_property: {} } },
      Plan: { type: "relation", relation: { data_source_id: "plans", single_property: {} } }
    } });
    if (url.pathname === "/v1/data_sources/plans") return response({ id: "plans", properties: { Identifier: { type: "rich_text" }, Title: { type: "title" } } });
    if (url.pathname === "/v1/data_sources/tasks/query") {
      const body = JSON.parse(String(init?.body));
      taskRequests.push(body);
      return response(body.start_cursor ? { results: second, has_more: false, next_cursor: null } : { results: first, has_more: true, next_cursor: "cursor-next" });
    }
    throw new Error(`unexpected request ${init?.method || "GET"} ${url.pathname}`);
  };
  const reader = new NotionTaskReader(new NotionClient("fixture-token", fetcher), "https://www.notion.so/00000000000000000000000000000001", DEFAULT_POLICY);

  const tasks = await reader.listTasks();

  assert.equal(tasks.length, 100);
  assert.equal(tasks.some(item => item.state === "Cancelled" || item.state === "Publisher Pending"), false);
  assert.equal(tasks.some(item => item.state === "Human Review"), true);
  assert.equal(tasks.some(item => item.state === "Merging"), true);
  assert.deepEqual(tasks[0].blockedBy, [{ title: "Task 2", state: "Backlog", url: "https://www.notion.so/task-2" }]);
  assert.deepEqual(taskRequests, [{ page_size: 100 }, { page_size: 100, start_cursor: "cursor-next" }]);
});

test("a failed read-only database binding is retried on the next task refresh", async () => {
  let databaseReads = 0;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/databases/00000000-0000-0000-0000-000000000001") {
      databaseReads += 1;
      if (databaseReads === 1) return new Response("temporary provider failure", { status: 503 });
      return response({ data_sources: [{ id: "tasks" }, { id: "plans" }] });
    }
    if (url.pathname === "/v1/data_sources/tasks") return response({ properties: {
      Identifier: { type: "rich_text" }, Title: { type: "title" }, State: { type: "select" }, Priority: { type: "number" }, Labels: { type: "multi_select" },
      "Blocked By": { id: "blocked-by", type: "relation", relation: { data_source_id: "tasks", single_property: {} } },
      Plan: { type: "relation", relation: { data_source_id: "plans", single_property: {} } }
    } });
    if (url.pathname === "/v1/data_sources/plans") return response({ properties: { Identifier: { type: "rich_text" }, Title: { type: "title" } } });
    if (url.pathname === "/v1/data_sources/tasks/query" && init?.method === "POST") return response({ results: [], has_more: false, next_cursor: null });
    throw new Error(`unexpected request ${url.pathname}`);
  };
  const reader = new NotionTaskReader(new NotionClient("fixture-token", fetcher), "https://www.notion.so/00000000000000000000000000000001", DEFAULT_POLICY);

  await assert.rejects(reader.listTasks(), /provider\/API failure \(503\)/);
  assert.deepEqual(await reader.listTasks(), []);
  assert.equal(databaseReads, 2);
});
