import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlanBlocks, DEFAULT_POLICY, PLAN_PROPERTY, PublicationError, PUBLISHER_PENDING_STATE, PUBLISHER_READY_STATE } from "../src/core.js";
import { NotionClient } from "../src/notion.js";
import { publishPlanFile } from "../src/cli.js";
import { publish } from "../src/publisher.js";

const DATABASE_URL = "https://notion.so/3d28a26586258052b3ecccc9c33787e3";

type Source = { id: string; properties: Record<string, any>; pages: Map<string, any> };

class PublicationFake extends NotionClient {
  sources = new Map<string, Source>();
  pages = new Map<string, any>();
  calls: { method: string; path: string; body?: any }[] = [];
  nextTask = 1;
  nextPlan = 1;
  failNextLock = false;
  failNextRelation = false;

  constructor() {
    super("token");
    this.sources.set("task-source", { id: "task-source", properties: taskSchema(), pages: new Map() });
  }

  addPlanPage(identifier: string, title = "Ship it"): string {
    const id = `plan-${this.nextPlan++}`;
    const page = { id, parent: { type: "data_source_id", data_source_id: "plan-source" }, properties: planProperties(identifier, title), is_locked: true, children: [] };
    this.pages.set(id, page);
    this.sources.get("plan-source")?.pages.set(id, page);
    return id;
  }

  async request(method: string, path: string, body?: any): Promise<any> {
    this.calls.push({ method, path, body });
    if (method === "PATCH" && path.startsWith("/pages/plan-") && body?.is_locked === true && this.failNextLock) {
      this.failNextLock = false;
      throw new PublicationError("injected Plan lock failure");
    }
    if (method === "PATCH" && body?.properties?.[PLAN_PROPERTY] && this.failNextRelation) {
      this.failNextRelation = false;
      throw new PublicationError("injected task relation failure");
    }

    if (method === "GET" && path.startsWith("/databases/")) return { data_sources: [...this.sources.values()].map(({ id }) => ({ id, name: id })) };
    const sourceMatch = path.match(/^\/data_sources\/([^/]+)$/);
    if (method === "GET" && sourceMatch) return this.sources.get(sourceMatch[1]);
    if (method === "PATCH" && sourceMatch) {
      const source = this.sources.get(sourceMatch[1]);
      for (const [name, definition] of Object.entries(body.properties ?? {})) {
        source!.properties[name] = { type: Object.keys(definition as Record<string, any>)[0], ...(definition as Record<string, any>) };
      }
      return source;
    }
    if (method === "POST" && path === "/data_sources") {
      const source = { id: "plan-source", properties: planSchema(), pages: new Map() };
      this.sources.set(source.id, source);
      return source;
    }
    const queryMatch = path.match(/^\/data_sources\/([^/]+)\/query$/);
    if (method === "POST" && queryMatch) {
      const source = this.sources.get(queryMatch[1]);
      const identifier = body.filter.rich_text.equals;
      return { results: [...(source?.pages.values() ?? [])].filter((page) => propertyValue(page.properties.Identifier) === identifier), has_more: false };
    }
    if (method === "POST" && path === "/pages") {
      const sourceId = body.parent.data_source_id;
      const id = sourceId === "task-source" ? `task-${this.nextTask++}` : `plan-${this.nextPlan++}`;
      const source = this.sources.get(sourceId)!;
      const properties = Object.fromEntries(Object.entries(body.properties).map(([name, value]) => [name, { type: source.properties[name]?.type, ...(value as Record<string, any>) }]));
      const page = { id, url: `https://notion.so/${id}`, parent: { type: "data_source_id", data_source_id: sourceId }, properties, is_locked: false, children: [] };
      this.pages.set(id, page);
      source.pages.set(id, page);
      return page;
    }
    const pageMatch = path.match(/^\/pages\/([^/]+)$/);
    if (method === "GET" && pageMatch) return this.pages.get(pageMatch[1]);
    if (method === "PATCH" && pageMatch) {
      const page = this.pages.get(pageMatch[1]);
      if (!page) throw new PublicationError("missing fake page");
      if (typeof body.is_locked === "boolean") page.is_locked = body.is_locked;
      const source = this.sources.get(page.parent.data_source_id)!;
      for (const [name, value] of Object.entries(body.properties ?? {})) page.properties[name] = { type: source.properties[name]?.type, ...(value as Record<string, any>) };
      return page;
    }
    const blocksMatch = path.match(/^\/blocks\/([^/]+)\/children/);
    if (method === "GET" && blocksMatch) return { results: this.pages.get(blocksMatch[1])?.children ?? [], has_more: false };
    if (method === "PATCH" && blocksMatch) {
      this.pages.get(blocksMatch[1])?.children.push(...body.children);
      return { results: body.children };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }

  taskPage(): any {
    return [...this.sources.get("task-source")!.pages.values()][0];
  }

  planPages(): any[] {
    return [...(this.sources.get("plan-source")?.pages.values() ?? [])];
  }
}

test("normal publisher entry point creates the two-source canonical representation", async () => {
  const { plan, config } = await inputs("# Ship it\naccepted plan");
  const client = new PublicationFake();
  const result = await publishPlanFile(plan, config, DATABASE_URL, client);
  const task = client.taskPage();
  const [planPage] = client.planPages();

  assert.equal(result.page_id, task.id);
  assert.deepEqual([...client.sources.keys()].sort(), ["plan-source", "task-source"]);
  assert.equal(client.sources.get("task-source")!.properties[PLAN_PROPERTY].relation.data_source_id, "plan-source");
  assert.deepEqual(task.properties[PLAN_PROPERTY].relation, [{ id: planPage.id }]);
  assert.equal(propertyValue(task.properties.Identifier), propertyValue(planPage.properties.Identifier));
  assert.equal(propertyValue(planPage.properties.Identifier), result.identifier);
  assert.equal(planPage.is_locked, true);
  assert.deepEqual(planPage.children.map((block: any) => block.paragraph.rich_text[0].text.content).join(""), "# Ship it\naccepted plan");
  assert.deepEqual(task.children, []);
  assert.equal(task.properties.State.rich_text[0].text.content, PUBLISHER_READY_STATE);
  assert.equal(client.calls.some((call) => call.method === "POST" && call.path === "/pages" && call.body.parent.type === "page_id"), false);
  assert.ok(client.calls.findIndex((call) => call.method === "PATCH" && call.path === `/pages/${planPage.id}` && call.body.is_locked === true) < client.calls.findIndex((call) => call.method === "PATCH" && call.path === `/pages/${task.id}` && call.body.properties?.[PLAN_PROPERTY]));
  assert.ok(client.calls.findIndex((call) => call.path === `/pages/${task.id}` && call.body?.properties?.State) > client.calls.findIndex((call) => call.path === `/pages/${task.id}` && call.body?.properties?.[PLAN_PROPERTY]));
});

test("pending recovery reuses the task and matching Plan page and completes a missing snapshot", async () => {
  const { plan, config } = await inputs("# Recover\naccepted");
  const client = new PublicationFake();
  client.failNextLock = true;
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /Plan lock failure/);
  const taskId = client.taskPage().id;
  const planId = client.planPages()[0].id;
  assert.equal(client.taskPage().properties.State.rich_text[0].text.content, PUBLISHER_PENDING_STATE);
  assert.equal(client.planPages()[0].is_locked, false);

  await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(client.taskPage().id, taskId);
  assert.equal(client.planPages()[0].id, planId);
  assert.equal(client.planPages().length, 1);
  assert.equal(client.taskPage().properties.State.rich_text[0].text.content, PUBLISHER_READY_STATE);
  assert.equal(client.planPages()[0].is_locked, true);
});

test("pending recovery restores relation after a provider failure without duplicating the Plan", async () => {
  const { plan, config } = await inputs("# Relation retry\naccepted");
  const client = new PublicationFake();
  client.failNextRelation = true;
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /task relation failure/);
  await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(client.planPages().length, 1);
  assert.equal(client.taskPage().properties[PLAN_PROPERTY].relation.length, 1);
});

test("pending tasks related to another publication or ambiguous Plan identity are rejected", async () => {
  const { plan, config } = await inputs("# Binding\naccepted");
  const wrong = new PublicationFake();
  wrong.failNextLock = true;
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, wrong));
  const wrongPlan = wrong.addPlanPage("PLAN-OTHER", "Other");
  wrong.taskPage().properties[PLAN_PROPERTY] = { type: "relation", relation: [{ id: wrongPlan }] };
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, wrong), /mismatched publication Identifier/);
  assert.equal(wrong.taskPage().properties.State.rich_text[0].text.content, PUBLISHER_PENDING_STATE);

  const ambiguous = new PublicationFake();
  ambiguous.failNextLock = true;
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, ambiguous));
  const matching = ambiguous.planPages()[0];
  const duplicate = ambiguous.addPlanPage(propertyValue(matching.properties.Identifier), propertyValue(matching.properties.Title));
  ambiguous.pages.get(duplicate)!.children = structuredClone(matching.children);
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, ambiguous), /matches 2 Plan pages/);
  assert.equal(ambiguous.taskPage().properties.State.rich_text[0].text.content, PUBLISHER_PENDING_STATE);
});

test("completed publications are never repaired even if Plan content is later changed", async () => {
  const { plan, config } = await inputs("# Immutable\naccepted");
  const client = new PublicationFake();
  await publishPlanFile(plan, config, DATABASE_URL, client);
  const planPage = client.planPages()[0];
  planPage.children = buildPlanBlocks("tampered");
  const calls = client.calls.length;
  await assert.rejects(publish({ plan: "# Immutable\naccepted", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } }), /duplicate publication/);
  assert.equal(client.calls.length, calls + 4);
  assert.deepEqual(planPage.children, buildPlanBlocks("tampered"));
});

test("empty Plan is rejected before Notion mutation", async () => {
  const client = new PublicationFake();
  await assert.rejects(publish({ plan: " \n", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } }), /non-empty/);
  assert.equal(client.calls.length, 0);
});

async function inputs(content: string) {
  const directory = await mkdtemp(join(tmpdir(), "publisher-cli-"));
  const plan = join(directory, "plan.md");
  const config = join(directory, "config.json");
  await writeFile(plan, content);
  await writeFile(config, JSON.stringify({ priority: 3 }));
  return { plan, config };
}

function taskSchema(planSource?: string): Record<string, any> {
  return {
    Identifier: { type: "rich_text" },
    Title: { type: "title" },
    State: { type: "rich_text" },
    Priority: { type: "number" },
    Labels: { type: "multi_select" },
    "Blocked By": { type: "relation", relation: { data_source_id: "task-source", single_property: {} } },
    ...(planSource ? { Plan: { type: "relation", relation: { data_source_id: planSource, single_property: {} } } } : {})
  };
}

function planSchema(): Record<string, any> {
  return { Identifier: { type: "rich_text" }, Title: { type: "title" } };
}

function planProperties(identifier: string, title: string): Record<string, any> {
  return { Identifier: { type: "rich_text", rich_text: [{ type: "text", text: { content: identifier } }] }, Title: { type: "title", title: [{ type: "text", text: { content: title } }] } };
}

function propertyValue(property: any): string {
  const type = property.title ? "title" : "rich_text";
  return property[type].map((part: any) => part.text?.content ?? part.plain_text ?? "").join("");
}
