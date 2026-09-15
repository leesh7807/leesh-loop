import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { buildPlanBlocks, buildPlanProperties, buildTaskProperties, chunkText, DEFAULT_POLICY, extractPlanTitle, notionId, PLAN_PROPERTY, PublicationError, PUBLISHER_PENDING_STATE, resolvePublishDatabase, validatePlanTitle } from "../src/core.js";

test("six-property task metadata and chunked Plan content are canonical", () => {
  const properties = buildTaskProperties(DEFAULT_POLICY, "PLAN-X", "Title");
  assert.deepEqual(Object.keys(properties).sort(), ["Blocked By", "Identifier", "Labels", "Plan", "Priority", "State", "Title"]);
  assert.equal("Description" in properties, false);
  assert.equal("Plan Source" in properties, false);
  assert.equal("branch_name" in properties, false);
  assert.deepEqual(properties.State, { select: { name: PUBLISHER_PENDING_STATE } });
  assert.deepEqual(properties[PLAN_PROPERTY], { relation: [] });
  assert.deepEqual(buildPlanProperties("PLAN-X", "Title"), { Identifier: { rich_text: [{ type: "text", text: { content: "PLAN-X" } }] }, Title: { title: [{ type: "text", text: { content: "Title" } }] } });
  assert.deepEqual(DEFAULT_POLICY.stateSeeds, ["backlog", "todo", "in_progress", "human_review", "rework", "merging", "done", "canceled"]);
  const blocks = buildPlanBlocks("x".repeat(4000));
  assert.equal(blocks.every((block: any) => block.type === "paragraph"), true);
  assert.equal(blocks.map((block: any) => block.paragraph.rich_text[0].text.content).join(""), "x".repeat(4000));
});

test("typed config keeps only durable task policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "publisher-")); const file = join(directory, "c.json");
  await writeFile(file, JSON.stringify({ labels: [" symphony "], priority: null, state_seeds: ["todo", "working", "review", "done"], property_names: { blocked_by: "Dependencies" } }));
  const { policy } = await loadConfig(file);
  assert.equal(policy.defaultPriority, null); assert.deepEqual(policy.defaultLabels, ["symphony"]); assert.deepEqual(policy.stateSeeds, ["todo", "working", "review", "done"]); assert.equal(policy.blockedBy, "Dependencies");
  await writeFile(file, JSON.stringify({ state: "Rework" }));
  await assert.rejects(loadConfig(file), /unknown configuration key/);
  await writeFile(file, JSON.stringify({ plan_source: "https://example.com" }));
  await assert.rejects(loadConfig(file), /unknown configuration key/);
});

test("property name collisions and malformed config are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "publisher-")); const file = join(directory, "c.json");
  await writeFile(file, JSON.stringify({ property_names: { identifier: "Task", title: "Task" } }));
  await assert.rejects(loadConfig(file), /unique property names/);
  await writeFile(file, JSON.stringify({ property_names: { title: "Plan" } }));
  await assert.rejects(loadConfig(file), /reserved Plan relation/);
  await writeFile(file, JSON.stringify({ labels: "not-list" }));
  await assert.rejects(loadConfig(file), PublicationError);
  await writeFile(file, JSON.stringify({ state_seeds: [""] }));
  await assert.rejects(loadConfig(file), /non-empty/);
});

test("title, destination, and rich text boundaries are validated", () => {
  const title = extractPlanTitle("# " + "x".repeat(1901)); assert.throws(() => validatePlanTitle(title), /title exceeds/);
  assert.equal(extractPlanTitle("body", "fallback"), "fallback"); assert.throws(() => extractPlanTitle("body"), /H1 or caller-supplied fallback/);
  assert.equal(notionId("https://www.notion.so/Avocado-d093f1d200464ce78b36e58a3f0d8043?x=1"), "d093f1d2-0046-4ce7-8b36-e58a3f0d8043");
  assert.throws(() => resolvePublishDatabase(undefined), /missing publication database URL/);
  const plan = "x".repeat(1899) + "😀tail"; const chunks = chunkText(plan); assert.equal(chunks.join(""), plan); assert.ok(chunks.every((chunk) => chunk.length <= 1900));
});
