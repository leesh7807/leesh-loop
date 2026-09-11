import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PublicationError, DEFAULT_POLICY, PUBLISHER_PENDING_STATE } from "../src/core.js";
import { NotionClient } from "../src/notion.js";
import { publishPlanFile } from "../src/cli.js";
import { publish } from "../src/publisher.js";

const DATABASE_URL = "https://notion.so/3d28a26586258052b3ecccc9c33787e3";

class PublicationFake extends NotionClient {
  phase: "none" | "pending" | "complete" = "none";
  created = 0; finalized: string[] = []; repaired: string[] = []; createdProperties: any; fail = false;
  override async ensureDatabase() { return "ds"; }
  override async findPublication() { return this.phase === "none" ? null : { pageId: "page", url: "https://notion.so/page", complete: this.phase === "complete" }; }
  override async createTask(_source: string, properties: any) { this.phase = "pending"; this.created += 1; this.createdProperties = properties; return { id: "page", url: "https://notion.so/page" }; }
  override async ensureCanonicalRepresentation() { if (this.fail) throw new PublicationError("provider/API failure while creating Plan"); }
  override async repairIncomplete(pageId: string) { this.repaired.push(pageId); if (this.fail) throw new PublicationError("provider/API failure while repairing Workpad"); }
  override async finalizePublication(pageId: string) { this.finalized.push(pageId); this.phase = "complete"; }
}

async function inputs() {
  const directory = await mkdtemp(join(tmpdir(), "publisher-cli-")); const plan = join(directory, "plan.md"); const config = join(directory, "config.json");
  await writeFile(plan, "# Plan\ncontent"); await writeFile(config, JSON.stringify({ state: "Ready" })); return { directory, plan, config };
}

test("success keeps Publisher Pending until canonical representation finalizes", async () => {
  const { plan, config } = await inputs(); const client = new PublicationFake("token");
  const result = await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(result.page_id, "page"); assert.equal(client.createdProperties.State.select.name, PUBLISHER_PENDING_STATE);
  assert.deepEqual(Object.keys(client.createdProperties).sort(), ["Blocked By", "Identifier", "Labels", "Priority", "State", "Title"]);
  assert.deepEqual(client.finalized, ["page"]);
});

test("failure leaves a pending page and retry repairs the same page", async () => {
  const { plan, config } = await inputs(); const client = new PublicationFake("token"); client.fail = true;
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /creating Plan/);
  assert.equal(client.phase, "pending"); assert.equal(client.created, 1); assert.deepEqual(client.finalized, []);
  client.fail = false; const repaired = await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(repaired.page_id, "page"); assert.equal(client.created, 1); assert.deepEqual(client.repaired, ["page"]); assert.equal(client.phase, "complete");
});

test("completed task is duplicate even if its structure was later damaged", async () => {
  const client = new PublicationFake("token"); client.phase = "complete";
  await assert.rejects(publish({ plan: "# Existing\ncontent", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } }), /duplicate publication/);
  assert.deepEqual(client.repaired, []);
});

test("empty Plan is rejected before Notion mutation and direct content remains supported", async () => {
  const client = new PublicationFake("token");
  await assert.rejects(publish({ plan: " \n", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } }), /non-empty/);
  assert.equal(client.created, 0);
  await publish({ plan: "body", fallbackTitle: "Direct Plan", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } });
  assert.equal(client.createdProperties.Title.title[0].text.content, "Direct Plan");
});

test("same destination and Plan are serialized in-process", async () => {
  const client = new PublicationFake("token"); const input = { plan: "# Concurrent\ncontent", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } };
  const results = await Promise.allSettled([publish(input), publish(input)]);
  assert.equal(client.created, 1); assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});
