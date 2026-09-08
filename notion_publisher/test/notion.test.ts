import test from "node:test";
import assert from "node:assert/strict";
import { NotionClient, PENDING_PUBLICATION_MARKER } from "../src/notion.js";
import { DEFAULT_POLICY, buildPageBlocks } from "../src/core.js";

class FakeClient extends NotionClient {
  responses: any[]; calls: any[] = [];
  constructor(responses: any[]) { super("token"); this.responses = responses; }
  override async request(method: string, path: string, body?: unknown) { this.calls.push({ method, path, body }); const result = this.responses.shift(); if (result instanceof Error) throw result; return result; }
}

const completeSchema = (dataSource = "ds") => ({ properties: {
  [DEFAULT_POLICY.identifier]: { type: "rich_text" }, [DEFAULT_POLICY.title]: { type: "title" }, [DEFAULT_POLICY.state]: { type: "select" }, [DEFAULT_POLICY.priority]: { type: "number" }, [DEFAULT_POLICY.labels]: { type: "multi_select" }, [DEFAULT_POLICY.blockedBy]: { type: "relation", relation: { data_source_id: dataSource, single_property: {} } }, [DEFAULT_POLICY.description]: { type: "rich_text" }, [DEFAULT_POLICY.source]: { type: "url" },
} });

test("configured database is resolved directly without parent discovery or destination creation", async () => {
  const c = new FakeClient([{ id: "db", data_sources: [{ id: "ds" }] }, completeSchema()]);
  assert.equal(await c.ensureDatabase("db", DEFAULT_POLICY), "ds");
  assert.deepEqual(c.calls.map(call => call.path), ["/databases/db", "/data_sources/ds"]);
  assert.equal(c.calls.some(call => call.path.includes("/children") || call.path === "/databases" || call.path === "/data_sources"), false);
});

test("configured database without one usable data source fails before schema or task mutation", async () => {
  const c = new FakeClient([{ id: "db", data_sources: [] }]);
  await assert.rejects(c.ensureDatabase("db", DEFAULT_POLICY), /exactly one usable data source/);
  assert.deepEqual(c.calls.map(call => call.path), ["/databases/db"]);
});

test("schema repair only patches the configured database data source", async () => {
  const c = new FakeClient([{ id: "db", data_sources: [{ id: "ds" }] }, { properties: { [DEFAULT_POLICY.title]: { type: "title" } } }, { ok: true }]);
  assert.equal(await c.ensureDatabase("db", DEFAULT_POLICY), "ds");
  assert.equal(c.calls[2].path, "/data_sources/ds");
  assert.ok((c.calls[2].body.properties as any)[DEFAULT_POLICY.blockedBy]);
});

test("incompatible schema fails before task creation and does not fall back", async () => {
  const c = new FakeClient([{ id: "db", data_sources: [{ id: "ds" }] }, { properties: { [DEFAULT_POLICY.identifier]: { type: "title" } } }]);
  await assert.rejects(c.ensureDatabase("db", DEFAULT_POLICY), /wrong type/);
  assert.deepEqual(c.calls.map(call => call.path), ["/databases/db", "/data_sources/ds"]);
});

test("incomplete identifier publication is repaired instead of treated as duplicate", async () => {
  const pending = { id: "pending", type: "heading_2", heading_2: { rich_text: [{ plain_text: PENDING_PUBLICATION_MARKER }] } };
  const old = { id: "old", type: "paragraph" };
  const c = new FakeClient([{ results: [{ id: "page", url: "url" }] }, { results: [pending] }, { results: [pending, old] }, { ok: true }, { ok: true }, { ok: true }, { results: [] }, { ok: true }]);
  const found = await c.findPublication("ds", DEFAULT_POLICY, "PLAN-X");
  assert.deepEqual(found, { pageId: "page", url: "url", complete: false });
  await c.repairIncomplete("page", buildPageBlocks(DEFAULT_POLICY, "plan"), DEFAULT_POLICY);
  assert.equal(c.calls[3].path, "/blocks/old");
  assert.equal(c.calls[7].path, "/pages/page");
});

test("dual Blocked By relation is schema drift", () => {
  const relation = { data_source_id: "ds", dual_property: { synced_property_name: "Other" } };
  assert.throws(() => new NotionClient("token").validateSchema({ properties: { ...completeSchema().properties, [DEFAULT_POLICY.blockedBy]: { type: "relation", relation } } }, DEFAULT_POLICY, "ds"), /single_property/);
});

test("request preserves authentication, direct-database access, and provider error categories", async () => {
  for (const [status, message] of [[401, "authentication failure"], [403, "configured database is inaccessible"], [500, "provider/API failure"]] as const) {
    const c = new NotionClient("token", async () => new Response("failure", { status }));
    await assert.rejects(c.request("GET", "/databases/x"), new RegExp(message));
  }
});

test("appendBlocks batches at the 50-block provider boundary", async () => {
  const c = new FakeClient(Array.from({ length: 2 }, () => ({ ok: true })));
  await c.appendBlocks("page", Array.from({ length: 51 }, () => ({ type: "paragraph" })));
  assert.equal(c.calls.filter(call => call.path === "/blocks/page/children").length, 2);
});
