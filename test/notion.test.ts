import { describe, expect, it } from "vitest";
import { defaultPolicy } from "../src/policy.js";
import { NotionPublisher, PublicationError, sectionBlocks, validateDataSourceSchema } from "../src/notion.js";
import { resolvePolicy } from "../src/policy.js";

describe("Notion coordination policy", () => {
  it("constructs independently addressable Plan and empty Workpad sections", () => {
    const blocks = sectionBlocks(defaultPolicy, "# plan\n\nkeep this exact");
    expect(blocks[0].heading_2.rich_text[0].text.content).toBe("Plan");
    expect(blocks.find(block => block.type === "code")?.code.rich_text[0].text.content).toBe("# plan\n\nkeep this exact");
    expect(blocks.at(-1)?.heading_2.rich_text[0].text.content).toBe("Workpad");
  });

  it("rejects a missing or incompatible canonical field without migrating it", () => {
    expect(() => validateDataSourceSchema({ id: "source", properties: {} }, defaultPolicy)).toThrow(/schema compatibility/);
    const properties: any = {
      Title: { type: "title" }, Identifier: { type: "rich_text" }, State: { type: "select" }, Priority: { type: "number" },
      Labels: { type: "multi_select" }, "Blocked By": { type: "relation", relation: { data_source_id: "source" } },
      "Plan Source": { type: "url" }, Created: { type: "created_time" }, Updated: { type: "last_edited_time" }
    };
    expect(() => validateDataSourceSchema({ id: "source", properties }, defaultPolicy)).not.toThrow();
    properties.Priority = { type: "rich_text" };
    expect(() => validateDataSourceSchema({ id: "source", properties }, defaultPolicy)).toThrow(/Priority.*number/);
  });

  it("publishes one page and rejects the same identifier on a second request", async () => {
    const source = { id: "source", object: "data_source", title: [{ plain_text: "Tasks" }], parent: { page_id: "12345678-1234-5678-1234-567812345678" }, properties: {
      Title: { type: "title" }, Identifier: { type: "rich_text" }, State: { type: "select" }, Priority: { type: "number" },
      Labels: { type: "multi_select" }, "Blocked By": { type: "relation", relation: { data_source_id: "source" } },
      "Plan Source": { type: "url" }, Created: { type: "created_time" }, Updated: { type: "last_edited_time" }
    } };
    const created: any[] = [];
    const fake: any = {
      search: async () => ({ results: [source], has_more: false }),
      dataSources: { retrieve: async () => source, query: async () => ({ results: created.length ? [{ id: "existing" }] : [], has_more: false }) },
      pages: { create: async (request: any) => { created.push(request); return { id: "page-id", url: "https://www.notion.so/page-id" }; } }
    };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    const config: any = { parentUrl: "https://www.notion.so/acme/Example-12345678123456781234567812345678", planSourceUrl: null, policy: resolvePolicy() };
    const plan: any = { identifier: "2026-09-05-example", title: "Example", content: "# 2026-09-05-example\n\nexact" };
    await expect(publisher.publish(config, plan)).resolves.toMatchObject({ id: "page-id", identifier: plan.identifier });
    expect(created[0].properties.Identifier.rich_text[0].text.content).toBe(plan.identifier);
    expect(created[0].children.at(-1).heading_2.rich_text[0].text.content).toBe("Workpad");
    await expect(publisher.publish(config, plan)).rejects.toBeInstanceOf(PublicationError);
    expect(created).toHaveLength(1);
  });
});
