import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PublicationError } from "../src/core.js";
import { NotionClient, PENDING_PUBLICATION_MARKER } from "../src/notion.js";
import { PUBLISHER_PENDING_STATE } from "../src/core.js";
import { publishPlanFile } from "../src/cli.js";
import { publish } from "../src/publisher.js";
import { DEFAULT_POLICY } from "../src/core.js";
const DATABASE_URL = "https://notion.so/3d28a26586258052b3ecccc9c33787e3";

class PublicationFake extends NotionClient {
  repaired: string[] = [];
  finalized: string[] = [];
  createdProperties: any;
  appendCalls = 0;
  ensuredDatabase?: string;
  constructor(private existing: { pageId: string; complete: boolean } | null = null, private failOnAppend = 2) { super("token"); }
  override async ensureDatabase(databaseId: string) { this.ensuredDatabase = databaseId; return "ds"; }
  override async findPublication() { return this.existing ? { ...this.existing } : null; }
  override async createTask(_dataSource: string, properties: any) { this.createdProperties = properties; return { id: "page", url: "https://notion.so/page" }; }
  override async appendBlocks() { this.appendCalls += 1; if (this.appendCalls === this.failOnAppend) throw new PublicationError("authentication failure: NOTION_TOKEN was rejected"); }
  override async repairIncomplete(pageId: string) { this.repaired.push(pageId); }
  override async finalizePublication(pageId: string) { this.finalized.push(pageId); }
}

async function inputs() {
  const directory = await mkdtemp(join(tmpdir(), "publisher-cli-"));
  const plan = join(directory, "plan.md");
  const config = join(directory, "config.json");
  await writeFile(plan, "# Plan\ncontent");
  await writeFile(config, JSON.stringify({ state: "Ready" }));
  return { directory, plan, config };
}

test("task creation followed by Plan append failure preserves retryable state", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake();
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /authentication failure/);
  assert.deepEqual(client.finalized, []);
});

test("first marker failure leaves an owned task marker", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake(null, 1);
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /authentication failure/);
  assert.equal(client.createdProperties.Description.rich_text[0].text.content, PENDING_PUBLICATION_MARKER);
  assert.deepEqual(client.finalized, []);
});

test("a later invocation repairs the incomplete publication", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake({ pageId: "page", complete: false });
  const result = await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(result.page_id, "page");
  assert.equal(client.ensuredDatabase, "3d28a265-8625-8052-b3ec-ccc9c33787e3");
  assert.deepEqual(client.repaired, ["page"]);
});

test("successful first publication removes its pending transaction state", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake(null, 0);
  const result = await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(result.page_id, "page");
  assert.equal(client.createdProperties.State.select.name, PUBLISHER_PENDING_STATE);
  assert.deepEqual(client.finalized, ["page"]);
});

test("CLI preserves its filename title fallback for a heading-less Plan", async () => {
  const { directory, config } = await inputs();
  const namedPlan = join(directory, "2026-09-10-add-adapter.md");
  await writeFile(namedPlan, "Implement the adapter contract.");
  const client = new PublicationFake(null, 0);
  await publishPlanFile(namedPlan, config, DATABASE_URL, client);
  assert.equal(client.createdProperties.Title.title[0].text.content, "2026-09-10-add-adapter.md");
});

class StatefulRetryFake extends NotionClient {
  phase: "none" | "pending" | "complete" = "none";
  planAppendAttempts = 0;
  override async ensureDatabase() { return "ds"; }
  override async findPublication() {
    if (this.phase === "none") return null;
    return { pageId: "page", url: "https://notion.so/page", complete: this.phase === "complete" };
  }
  override async createTask() { this.phase = "pending"; return { id: "page", url: "https://notion.so/page" }; }
  override async appendBlocks() { this.planAppendAttempts += 1; if (this.planAppendAttempts === 2) throw new PublicationError("provider/API failure during Plan append"); }
  override async repairIncomplete() { this.phase = "complete"; }
  override async finalizePublication() { this.phase = "complete"; }
}

test("failed publication is repaired by the next invocation and then becomes a duplicate", async () => {
  const { plan, config } = await inputs();
  const client = new StatefulRetryFake("token");
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /Plan append/);
  const repaired = await publishPlanFile(plan, config, DATABASE_URL, client);
  assert.equal(repaired.page_id, "page");
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /duplicate publication/);
});

class ConcurrentPublicationFake extends NotionClient {
  phase: "none" | "complete" = "none";
  created = 0;
  override async ensureDatabase() { return "ds"; }
  override async findPublication() { return this.phase === "none" ? null : { pageId: "page", complete: true }; }
  override async createTask() { this.created += 1; return { id: "page", url: "https://notion.so/page" }; }
  override async appendBlocks() {}
  override async finalizePublication() { this.phase = "complete"; }
}

test("concurrent in-process publication calls create only one task", async () => {
  const client = new ConcurrentPublicationFake("token");
  const input = { plan: "# Concurrent Plan\ncontent", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } };
  const results = await Promise.allSettled([publish(input), publish(input)]);
  assert.equal(client.created, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason.message, /duplicate publication/);
});

test("oversized plan title fails before Notion mutation", async () => {
  const { plan, config } = await inputs();
  await writeFile(plan, `# ${"x".repeat(1901)}\ncontent`);
  const client = new PublicationFake();
  await assert.rejects(publishPlanFile(plan, config, DATABASE_URL, client), /title exceeds/);
  assert.deepEqual(client.finalized, []);
});

test("missing or invalid database binding fails before any Notion mutation", async () => {
  const { plan, config } = await inputs();
  for (const target of [undefined, "https://example.com/notion-database"]) {
    const client = new PublicationFake(null, 0);
    await assert.rejects(publishPlanFile(plan, config, target as string, client), /publication database URL|invalid database URL/);
    assert.equal(client.appendCalls, 0);
    assert.equal(client.createdProperties, undefined);
  }
});

test("CLI requires an explicit destination and does not use an environment destination", async () => {
  const { plan, config, directory } = await inputs();
  await writeFile(join(directory, ".env"), "NOTION_TOKEN=local-token");
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--plan", plan, "--config", config], {
    cwd: directory,
    env: { ...process.env, NOTION_TOKEN: "process-token", NOTION_PUBLISH_DATABASE_URL: "https://example.com/notion-database" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--database-url URL/);
});

test("publisher core publishes in-memory Plan content without environment or filesystem discovery", async () => {
  const client = new PublicationFake(null, 0);
  const original = process.env.NOTION_PUBLISH_DATABASE_URL;
  delete process.env.NOTION_PUBLISH_DATABASE_URL;
  try {
    const result = await publish({ plan: "# In-memory Plan\ncontent", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } });
    assert.equal(result.page_id, "page");
    assert.equal(client.ensuredDatabase, "3d28a265-8625-8052-b3ec-ccc9c33787e3");
  } finally {
    if (original === undefined) delete process.env.NOTION_PUBLISH_DATABASE_URL;
    else process.env.NOTION_PUBLISH_DATABASE_URL = original;
  }
});

test("heading-less in-memory Plans require a caller-resolved fallback title", async () => {
  const client = new PublicationFake(null, 0);
  await assert.rejects(publish({ plan: "Plain text Plan", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } }), /H1 or caller-supplied fallback title/);
  await publish({ plan: "Plain text Plan", fallbackTitle: "Operator Plan", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } });
  assert.equal(client.createdProperties.Title.title[0].text.content, "Operator Plan");
});

test("publisher core never lets an environment destination override its caller", async () => {
  const client = new PublicationFake(null, 0);
  const original = process.env.NOTION_PUBLISH_DATABASE_URL;
  process.env.NOTION_PUBLISH_DATABASE_URL = "https://example.com/notion-database";
  try {
    await publish({ plan: "# Explicit Destination\ncontent", databaseUrl: DATABASE_URL, client, config: { policy: DEFAULT_POLICY } });
    assert.equal(client.ensuredDatabase, "3d28a265-8625-8052-b3ec-ccc9c33787e3");
  } finally {
    if (original === undefined) delete process.env.NOTION_PUBLISH_DATABASE_URL;
    else process.env.NOTION_PUBLISH_DATABASE_URL = original;
  }
});
