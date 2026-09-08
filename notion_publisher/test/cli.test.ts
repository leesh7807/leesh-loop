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
import { publishPlan } from "../src/cli.js";
const TARGET_URL = "https://notion.so/3d28a26586258052b3ecccc9c33787e3";

class PublicationFake extends NotionClient {
  repaired: string[] = [];
  finalized: string[] = [];
  createdProperties: any;
  appendCalls = 0;
  constructor(private existing: { pageId: string; complete: boolean } | null = null, private failOnAppend = 2) { super("token"); }
  override async ensureSurface() { return "ds"; }
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
  await assert.rejects(publishPlan(plan, config, TARGET_URL, client), /authentication failure/);
  assert.deepEqual(client.finalized, []);
});

test("first marker failure leaves an owned task marker", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake(null, 1);
  await assert.rejects(publishPlan(plan, config, TARGET_URL, client), /authentication failure/);
  assert.equal(client.createdProperties.Description.rich_text[0].text.content, PENDING_PUBLICATION_MARKER);
  assert.deepEqual(client.finalized, []);
});

test("a later invocation repairs the incomplete publication", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake({ pageId: "page", complete: false });
  const result = await publishPlan(plan, config, TARGET_URL, client);
  assert.equal(result.page_id, "page");
  assert.deepEqual(client.repaired, ["page"]);
});

test("successful first publication removes its pending transaction state", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake(null, 0);
  const result = await publishPlan(plan, config, TARGET_URL, client);
  assert.equal(result.page_id, "page");
  assert.equal(client.createdProperties.State.select.name, PUBLISHER_PENDING_STATE);
  assert.deepEqual(client.finalized, ["page"]);
});

class StatefulRetryFake extends NotionClient {
  phase: "none" | "pending" | "complete" = "none";
  planAppendAttempts = 0;
  override async ensureSurface() { return "ds"; }
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
  await assert.rejects(publishPlan(plan, config, TARGET_URL, client), /Plan append/);
  const repaired = await publishPlan(plan, config, TARGET_URL, client);
  assert.equal(repaired.page_id, "page");
  await assert.rejects(publishPlan(plan, config, TARGET_URL, client), /duplicate publication/);
});

test("oversized plan title fails before Notion mutation", async () => {
  const { plan, config } = await inputs();
  await writeFile(plan, `# ${"x".repeat(1901)}\ncontent`);
  const client = new PublicationFake();
  await assert.rejects(publishPlan(plan, config, TARGET_URL, client), /title exceeds/);
  assert.deepEqual(client.finalized, []);
});

test("missing or invalid target fails before any Notion mutation", async () => {
  const { plan, config } = await inputs();
  for (const target of [undefined, "https://example.com/notion-page"]) {
    const client = new PublicationFake(null, 0);
    await assert.rejects(publishPlan(plan, config, target, client), /NOTION_PUBLISH_TARGET_URL|invalid target URL/);
    assert.equal(client.appendCalls, 0);
    assert.equal(client.createdProperties, undefined);
  }
});

test("normal CLI loads its target from current-directory .env and honors process overrides", async () => {
  const { plan, config, directory } = await inputs();
  await writeFile(join(directory, ".env"), ["NOTION_TOKEN=local-token", `NOTION_PUBLISH_TARGET_URL=${TARGET_URL}`].join("\n"));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "--plan", plan, "--config", config], {
    cwd: directory,
    env: { ...process.env, NOTION_TOKEN: "process-token", NOTION_PUBLISH_TARGET_URL: "https://example.com/notion-page" },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid target URL/);
});
