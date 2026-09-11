import test from "node:test";
import assert from "node:assert/strict";
import { NotionClient } from "../src/notion.js";
import { DEFAULT_POLICY, PUBLISHER_PENDING_STATE } from "../src/core.js";

const completeSchema = (dataSource = "ds", extra = {}) => ({ properties: {
  [DEFAULT_POLICY.identifier]: { type: "rich_text" }, [DEFAULT_POLICY.title]: { type: "title" }, [DEFAULT_POLICY.state]: { type: "select" }, [DEFAULT_POLICY.priority]: { type: "number" }, [DEFAULT_POLICY.labels]: { type: "multi_select" }, [DEFAULT_POLICY.blockedBy]: { type: "relation", relation: { data_source_id: dataSource, single_property: {} } }, ...extra,
} });

class RequestFake extends NotionClient {
  calls: any[] = [];
  constructor(private responses: any[]) { super("token"); }
  override async request(method: string, path: string, body?: unknown) { this.calls.push({ method, path, body }); const response = this.responses.shift(); if (response instanceof Error) throw response; return response; }
}

test("schema bootstraps only six canonical metadata properties and preserves extras", async () => {
  const extra = { Description: { type: "rich_text" }, "Plan Source": { type: "url" }, Custom: { type: "checkbox" } };
  const client = new RequestFake([{ data_sources: [{ id: "ds" }] }, completeSchema("ds", extra)]);
  assert.equal(await client.ensureDatabase("db", DEFAULT_POLICY), "ds");
  assert.equal(client.calls.length, 2);
  const missing = new RequestFake([{ data_sources: [{ id: "ds" }] }, { properties: { Title: { type: "title" } } }, {}]);
  await missing.ensureDatabase("db", DEFAULT_POLICY);
  assert.deepEqual(Object.keys(missing.calls[2].body.properties).sort(), ["Blocked By", "Identifier", "Labels", "Priority", "State"]);
  assert.equal("Description" in missing.calls[2].body.properties, false);
});

test("identifier lookup distinguishes pending, completed, and ambiguity without body inspection", async () => {
  const pending = { id: "pending", properties: { State: { select: { name: PUBLISHER_PENDING_STATE } } } };
  const completed = { id: "done", properties: { State: { select: { name: "Ready" } } } };
  const onePending = new RequestFake([{ results: [pending] }]);
  assert.deepEqual(await onePending.findPublication("ds", DEFAULT_POLICY, "PLAN-X"), { pageId: "pending", url: undefined, complete: false });
  assert.equal(onePending.calls.some((call) => call.path.includes("/children")), false);
  const oneCompleted = new RequestFake([{ results: [completed] }]);
  assert.deepEqual(await oneCompleted.findPublication("ds", DEFAULT_POLICY, "PLAN-X"), { pageId: "done", url: undefined, complete: true });
  const ambiguous = new RequestFake([{ results: [pending, completed] }]);
  await assert.rejects(ambiguous.findPublication("ds", DEFAULT_POLICY, "PLAN-X"), /Identifier invariant violation/);
});

class StructureFake extends NotionClient {
  children = new Map<string, any[]>([["task", []]]); created: string[] = [];
  override async listChildren(id: string) { return this.children.get(id) ?? []; }
  override async request(method: string, path: string, body?: any) {
    if (method === "POST" && path === "/pages") {
      const title = body.properties.title.title[0].text.content; const id = title.toLowerCase(); const page = { id, type: "child_page", child_page: { title } };
      this.children.get(body.parent.page_id)!.push(page); this.children.set(id, []); this.created.push(title); return { id };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }
  override async appendBlocks(id: string, blocks: any[]) { this.children.get(id)!.push(...blocks.map((block) => ({ ...block, paragraph: block.paragraph && { rich_text: block.paragraph.rich_text.map((part: any) => ({ ...part, plain_text: part.text.content })) } }))); }
}

test("canonical representation creates independent Plan and Workpad pages and validates complete Plan", async () => {
  const client = new StructureFake("token");
  await client.ensureCanonicalRepresentation("task", "# Ship it\naccepted plan");
  assert.deepEqual(client.created, ["Plan", "Workpad"]);
  assert.deepEqual(client.children.get("task")!.map((page) => page.child_page.title), ["Plan", "Workpad"]);
  assert.equal(client.children.get("plan")!.map((block: any) => block.paragraph.rich_text[0].plain_text).join(""), "# Ship it\naccepted plan");
  assert.deepEqual(client.children.get("workpad"), []);
  await client.ensureCanonicalRepresentation("task", "# Ship it\naccepted plan");
  assert.deepEqual(client.created, ["Plan", "Workpad"]);
});

test("pending repair rejects duplicate surfaces or conflicting Plan content", async () => {
  const client = new StructureFake("token");
  client.children.set("task", [{ id: "plan-a", type: "child_page", child_page: { title: "Plan" } }, { id: "plan-b", type: "child_page", child_page: { title: "Plan" } }]);
  await assert.rejects(client.ensureCanonicalRepresentation("task", "plan"), /multiple Plan/);
  const conflict = new StructureFake("token");
  conflict.children.set("task", [{ id: "plan", type: "child_page", child_page: { title: "Plan" } }]);
  conflict.children.set("plan", [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "other" }] } }]);
  await assert.rejects(conflict.ensureCanonicalRepresentation("task", "plan"), /differs/);
});

test("provider failure categories and pagination remain explicit", async () => {
  for (const [status, message] of [[401, "authentication failure"], [403, "configured database is inaccessible"], [500, "provider/API failure"]] as const) {
    const client = new NotionClient("token", async () => new Response("failure", { status }));
    await assert.rejects(client.request("GET", "/databases/x"), new RegExp(message));
  }
});
