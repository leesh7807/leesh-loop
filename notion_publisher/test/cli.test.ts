import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PublicationError } from "../src/core.js";
import { NotionClient } from "../src/notion.js";
import { publishPlan } from "../src/cli.js";

class PublicationFake extends NotionClient {
  archived: string[] = [];
  repaired: string[] = [];
  appendCalls = 0;
  constructor(private existing: { pageId: string; complete: boolean } | null = null) { super("token"); }
  override async ensureSurface() { return "ds"; }
  override async findPublication() { return this.existing ? { ...this.existing } : null; }
  override async createTask() { return { id: "page", url: "https://notion.so/page" }; }
  override async appendBlocks() { this.appendCalls += 1; if (this.appendCalls > 1) throw new PublicationError("authentication failure: NOTION_TOKEN was rejected"); }
  override async archive(pageId: string) { this.archived.push(pageId); }
  override async repairIncomplete(pageId: string) { this.repaired.push(pageId); }
}

async function inputs() {
  const directory = await mkdtemp(join(tmpdir(), "publisher-cli-"));
  const plan = join(directory, "plan.md");
  const config = join(directory, "config.json");
  await writeFile(plan, "# Plan\ncontent");
  await writeFile(config, JSON.stringify({ parent_url: "https://notion.so/3d28a26586258052b3ecccc9c33787e3" }));
  return { plan, config };
}

test("task creation followed by Plan append failure attempts cleanup and preserves error", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake();
  await assert.rejects(publishPlan(plan, config, client), /authentication failure/);
  assert.deepEqual(client.archived, ["page"]);
});

test("a later invocation repairs the incomplete publication", async () => {
  const { plan, config } = await inputs();
  const client = new PublicationFake({ pageId: "page", complete: false });
  const result = await publishPlan(plan, config, client);
  assert.equal(result.page_id, "page");
  assert.deepEqual(client.repaired, ["page"]);
});

test("oversized plan title fails before Notion mutation", async () => {
  const { plan, config } = await inputs();
  await writeFile(plan, `# ${"x".repeat(1901)}\ncontent`);
  const client = new PublicationFake();
  await assert.rejects(publishPlan(plan, config, client), /title exceeds/);
  assert.deepEqual(client.archived, []);
});
