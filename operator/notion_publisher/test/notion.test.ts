import test from "node:test";
import assert from "node:assert/strict";
import { NotionClient } from "../src/notion.js";
import { DEFAULT_POLICY, PLAN_PROPERTY, PUBLISHER_PENDING_STATE } from "../src/core.js";

const planSchema = { properties: { Identifier: { type: "rich_text" }, Title: { type: "title" } } };

class RequestFake extends NotionClient {
  calls: any[] = [];
  constructor(private responses: any[]) { super("token"); }
  override async request(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

test("a pristine title-only source is bootstrapped, including title rename and State seeds", async () => {
  const task = { id: "task-source", properties: { Name: { id: "name-id", type: "title" } } };
  const client = new RequestFake([
    { data_sources: [{ id: "task-source" }] },
    task,
    { results: [], has_more: false },
    { id: "plan-source", properties: planSchema.properties },
    { properties: planSchema.properties },
    {},
    { properties: taskSchema("plan-source") }
  ]);

  assert.deepEqual(await client.ensureDatabase("db", DEFAULT_POLICY), { taskDataSourceId: "task-source", planDataSourceId: "plan-source" });
  assert.deepEqual(client.calls.map((call) => [call.method, call.path]), [
    ["GET", "/databases/db"],
    ["GET", "/data_sources/task-source"],
    ["POST", "/data_sources/task-source/query"],
    ["POST", "/data_sources"],
    ["GET", "/data_sources/plan-source"],
    ["PATCH", "/data_sources/task-source"],
    ["GET", "/data_sources/task-source"]
  ]);
  assert.deepEqual(client.calls[3].body, {
    parent: { database_id: "db" },
    title: [{ type: "text", text: { content: "Plans" } }],
    properties: { Identifier: { rich_text: {} }, Title: { title: {} } }
  });
  assert.deepEqual(client.calls[5].body.properties.Plan, { relation: { data_source_id: "plan-source", single_property: {} } });
  assert.deepEqual(client.calls[5].body.properties.State, { select: { options: DEFAULT_POLICY.stateSeeds.map(name => ({ name })) } });
  assert.deepEqual(client.calls[5].body.properties["name-id"], { title: {}, name: "Title" });
});

test("existing canonical sources are selected structurally and extras are preserved", async () => {
  const client = new RequestFake([
    { data_sources: [{ id: "plan-source", name: "Tasks" }, { id: "task-source", name: "Not Plans" }] },
    { properties: planSchema.properties, custom: true },
    { properties: taskSchema("plan-source"), custom: true }
  ]);

  assert.deepEqual(await client.ensureDatabase("db", DEFAULT_POLICY), { taskDataSourceId: "task-source", planDataSourceId: "plan-source" });
  assert.equal(client.calls.some((call) => call.method === "PATCH"), false);
});

test("an exact bootstrap prefix resumes without creating a replacement Plan source", async () => {
  const client = new RequestFake([
    { data_sources: [{ id: "task-source" }, { id: "plan-source" }] },
    { properties: { Name: { id: "name-id", type: "title" } } },
    { properties: planSchema.properties },
    { results: [], has_more: false },
    { results: [], has_more: false },
    {},
    { properties: taskSchema("plan-source") }
  ]);

  assert.deepEqual(await client.ensureDatabase("db", DEFAULT_POLICY), { taskDataSourceId: "task-source", planDataSourceId: "plan-source" });
  assert.equal(client.calls.some((call) => call.method === "POST" && call.path === "/data_sources"), false);
  assert.equal(client.calls.filter((call) => call.method === "PATCH" && call.path === "/data_sources/task-source").length, 1);
});

test("a populated partial-bootstrap Plan source is rejected before task mutation", async () => {
  const client = new RequestFake([
    { data_sources: [{ id: "task-source" }, { id: "plan-source" }] },
    { properties: { Name: { type: "title" } } },
    { properties: planSchema.properties },
    { results: [], has_more: false },
    { results: [{ id: "existing-plan" }], has_more: false }
  ]);
  await assert.rejects(client.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
  assert.equal(client.calls.some((call) => call.method === "PATCH" || (call.method === "POST" && call.path === "/data_sources")), false);
});

test("rows and legacy rich-text State are unsupported without bootstrap mutations", async () => {
  const withRow = new RequestFake([
    { data_sources: [{ id: "task-source" }] },
    { properties: { Name: { type: "title" } } },
    { results: [{ id: "existing-row" }], has_more: false }
  ]);
  await assert.rejects(withRow.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
  assert.equal(withRow.calls.some((call) => call.method === "PATCH" || (call.method === "POST" && call.path === "/data_sources")), false);

  const legacy = new RequestFake([
    { data_sources: [{ id: "task-source" }] },
    { properties: { Name: { type: "title" }, State: { type: "rich_text" } } }
  ]);
  await assert.rejects(legacy.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
  assert.equal(legacy.calls.some((call) => call.method === "PATCH" || call.method === "POST"), false);

  const arbitraryPartial = new RequestFake([
    { data_sources: [{ id: "task-source" }] },
    { properties: { Name: { type: "title" }, Identifier: { type: "rich_text" } } }
  ]);
  await assert.rejects(arbitraryPartial.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
  assert.equal(arbitraryPartial.calls.some((call) => call.method === "PATCH" || call.method === "POST"), false);
});

test("non-pristine secondary sources are rejected without creating another destination", async () => {
  const client = new RequestFake([
    { data_sources: [{ id: "task-source" }, { id: "foreign-source" }] },
    { properties: { Name: { type: "title" } } },
    { properties: { ...planSchema.properties, Notes: { type: "rich_text" } } },
    { results: [], has_more: false }
  ]);

  await assert.rejects(client.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
  assert.equal(client.calls.some((call) => call.method === "POST" && call.path === "/data_sources"), false);
});

test("multiple task or Plan sources fail without heuristic selection", async () => {
  const taskSources = new RequestFake([
    { data_sources: [{ id: "task-a" }, { id: "task-b" }, { id: "plan-source" }] },
    { properties: taskSchema("plan-source", "task-a") },
    { properties: taskSchema("plan-source", "task-b") },
    { properties: planSchema.properties }
  ]);
  await assert.rejects(taskSources.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);

  const planSources = new RequestFake([
    { data_sources: [{ id: "task-source" }, { id: "plan-a" }, { id: "plan-b" }] },
    { properties: taskSchema("plan-a") },
    { properties: planSchema.properties },
    { properties: planSchema.properties }
  ]);
  await assert.rejects(planSources.ensureDatabase("db", DEFAULT_POLICY), /The selected Notion database is not empty/);
});

test("identifier lookup never inspects task body and distinguishes pending from completed", async () => {
  const pending = { id: "pending", properties: { State: { type: "select", select: { name: PUBLISHER_PENDING_STATE } } } };
  const completed = { id: "done", properties: { State: { type: "select", select: { name: "custom_review" } } } };
  const onePending = new RequestFake([{ results: [pending], has_more: false }]);
  assert.deepEqual(await onePending.findPublication("task-source", DEFAULT_POLICY, "PLAN-X"), { pageId: "pending", url: undefined, complete: false });
  assert.equal(onePending.calls.some((call) => call.path.includes("/children")), false);
  const oneCompleted = new RequestFake([{ results: [completed], has_more: false }]);
  assert.deepEqual(await oneCompleted.findPublication("task-source", DEFAULT_POLICY, "PLAN-X"), { pageId: "done", url: undefined, complete: true });
  const malformedState = new RequestFake([{ results: [{ id: "malformed", properties: {} }], has_more: false }]);
  await assert.rejects(malformedState.findPublication("task-source", DEFAULT_POLICY, "PLAN-X"), /malformed State/);
  const ambiguous = new RequestFake([{ results: [pending, completed], has_more: false }]);
  await assert.rejects(ambiguous.findPublication("task-source", DEFAULT_POLICY, "PLAN-X"), /Identifier invariant violation/);
});

test("finalization, relation wiring, and page locking use their provider-native operations", async () => {
  const client = new RequestFake([{}, {}, {}]);
  await client.lockPlanPage("plan-page");
  await client.setTaskPlanRelation("task-page", "plan-page");
  await client.finalizePublication("task-page", DEFAULT_POLICY);
  assert.deepEqual(client.calls.map((call) => call.body), [
    { is_locked: true },
    { properties: { [PLAN_PROPERTY]: { relation: [{ id: "plan-page" }] } } },
    { properties: { State: { select: { name: "Ready" } } } }
  ]);
});

test("provider failures and malformed pagination remain explicit", async () => {
  for (const [status, message] of [[401, "authentication failure"], [403, "configured database is inaccessible"], [500, "provider/API failure"]] as const) {
    const client = new NotionClient("token", async () => new Response("failure", { status }));
    await assert.rejects(client.request("GET", "/databases/x"), new RegExp(message));
  }
  const malformed = new RequestFake([{ results: [], has_more: true }]);
  await assert.rejects(malformed.findPublication("task-source", DEFAULT_POLICY, "PLAN-X"), /omitted next_cursor/);
});

function taskSchema(planSource: string, taskSource = "task-source") {
  return {
    Identifier: { type: "rich_text" },
    Title: { type: "title" },
    State: { type: "select" },
    Priority: { type: "number" },
    Labels: { type: "multi_select" },
    "Blocked By": { type: "relation", relation: { data_source_id: taskSource, single_property: {} } },
    Plan: { type: "relation", relation: { data_source_id: planSource, single_property: {} } }
  };
}
