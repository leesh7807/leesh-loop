import { describe, expect, it } from "vitest";
import { defaultPolicy } from "../src/policy.js";
import { NotionPublisher, PublicationError, classifyNotionError, sectionBlocks, validateDataSourceSchema } from "../src/notion.js";
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

  it("maps provider authentication, permission, not-found, and generic failures", () => {
    expect(classifyNotionError({ status: 401 }).message).toMatch(/^authentication failure:/);
    expect(classifyNotionError({ status: 403 }).message).toMatch(/^target inaccessible:/);
    expect(classifyNotionError({ status: 404 }).message).toMatch(/^target inaccessible:/);
    expect(classifyNotionError({ status: 500, message: "rate limited" }).message).toMatch(/^provider\/API failure: rate limited$/);
  });

  it("batches oversized page children after the initial page create", async () => {
    const source = { id: "source", object: "data_source", title: [{ plain_text: "Tasks" }], parent: { page_id: "12345678-1234-5678-1234-567812345678" }, properties: {
      Title: { type: "title" }, Identifier: { type: "rich_text" }, State: { type: "select" }, Priority: { type: "number" },
      Labels: { type: "multi_select" }, "Blocked By": { type: "relation", relation: { data_source_id: "source" } },
      "Plan Source": { type: "url" }, Created: { type: "created_time" }, Updated: { type: "last_edited_time" }
    } };
    const appends: any[] = [];
    const fake: any = {
      search: async () => ({ results: [source], has_more: false }),
      dataSources: { retrieve: async () => source, query: async () => ({ results: [], has_more: false }) },
      pages: { create: async (request: any) => { expect(request.children).toHaveLength(100); return { id: "page-id", url: "https://www.notion.so/page-id" }; } },
      blocks: { children: { append: async (request: any) => { appends.push(request); } } }
    };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    const config: any = { parentUrl: "https://www.notion.so/acme/Example-12345678123456781234567812345678", planSourceUrl: null, policy: resolvePolicy() };
    const plan: any = { identifier: "long-plan", title: "Long plan", content: "x".repeat(1900 * 101) };
    await expect(publisher.publish(config, plan)).resolves.toMatchObject({ id: "page-id" });
    expect(appends.length).toBeGreaterThan(0);
    expect(appends.every(request => request.block_id === "page-id" && request.children.length <= 100)).toBe(true);
  });

  it("fails instead of choosing arbitrarily when duplicate surfaces match", async () => {
    const surface = (id: string) => ({ id, object: "data_source", title: [{ plain_text: "Tasks" }], parent: { page_id: "12345678-1234-5678-1234-567812345678" } });
    const fake: any = { search: async () => ({ results: [surface("one"), surface("two")], has_more: false }), dataSources: {} };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    await expect(publisher.findOrBootstrap("https://www.notion.so/acme/Example-12345678123456781234567812345678")).rejects.toThrow(/multiple 'Tasks' surfaces/);
  });

  it("batches oversized Workpad updates", async () => {
    const appends: any[] = [];
    const fake: any = {
      blocks: {
        children: {
          list: async () => ({ results: [{ id: "workpad", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Workpad" }] } }], has_more: false }),
          append: async (request: any) => appends.push(request)
        },
        delete: async () => undefined
      }
    };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    await publisher.updateWorkpad("page-id", "x".repeat(1900 * 101));
    expect(appends.length).toBeGreaterThan(1);
    expect(appends.every(request => request.block_id === "page-id" && request.children.length <= 100)).toBe(true);
  });

  it("rolls back a created page when a later Plan append fails", async () => {
    const source = { id: "source", object: "data_source", title: [{ plain_text: "Tasks" }], parent: { page_id: "12345678-1234-5678-1234-567812345678" }, properties: {
      Title: { type: "title" }, Identifier: { type: "rich_text" }, State: { type: "select" }, Priority: { type: "number" },
      Labels: { type: "multi_select" }, "Blocked By": { type: "relation", relation: { data_source_id: "source" } },
      "Plan Source": { type: "url" }, Created: { type: "created_time" }, Updated: { type: "last_edited_time" }
    } };
    const trashed: string[] = [];
    const fake: any = {
      search: async () => ({ results: [source], has_more: false }),
      dataSources: { retrieve: async () => source, query: async () => ({ results: [], has_more: false }) },
      pages: {
        create: async () => ({ id: "partial-page", url: "https://www.notion.so/partial-page" }),
        update: async (request: any) => { trashed.push(request.page_id); }
      },
      blocks: { children: { append: async () => { throw Object.assign(new Error("network down"), { status: 503 }); } }, delete: async () => undefined }
    };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    const config: any = { parentUrl: "https://www.notion.so/acme/Example-12345678123456781234567812345678", planSourceUrl: null, policy: resolvePolicy() };
    const plan: any = { identifier: "long-plan", title: "Long plan", content: "x".repeat(1900 * 101) };
    await expect(publisher.publish(config, plan)).rejects.toThrow(/provider\/API failure/);
    expect(trashed).toEqual(["partial-page"]);
  });

  it("keeps the existing Workpad when appending replacement content fails", async () => {
    const deleted: string[] = [];
    const fake: any = {
      blocks: {
        children: { list: async () => ({ results: [
          { id: "workpad", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Workpad" }] } },
          { id: "old-content", type: "paragraph", paragraph: { rich_text: [{ plain_text: "old" }] } }
        ], has_more: false }), append: async () => { throw new Error("network down"); } },
        delete: async ({ block_id }: any) => deleted.push(block_id)
      }
    };
    const publisher = new NotionPublisher(fake, resolvePolicy());
    await expect(publisher.updateWorkpad("page-id", "new content")).rejects.toThrow(/provider\/API failure/);
    expect(deleted).not.toContain("old-content");
  });
});
