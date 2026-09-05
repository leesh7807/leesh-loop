import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { identifierFromPath, parseNotionPageId, readConfig, titleFromMarkdown } from "../src/domain.js";
import { normalizeLabels, resolvePolicy } from "../src/policy.js";

describe("plan metadata", () => {
  it("derives the stable identifier from the filename", () => expect(identifierFromPath("/outside/repo/2026-09-05-notion-plan-publisher.md")).toBe("2026-09-05-notion-plan-publisher"));
  it("normalizes the dated plan heading into a title", () => expect(titleFromMarkdown("# 2026-09-05-notion-plan-publisher\n\nBody")).toBe("Notion plan publisher"));
  it("rejects a plan without a level-one heading", () => expect(() => titleFromMarkdown("## no title")).toThrow(/level-one heading/));
  it("parses a Notion URL without depending on its current working directory", () => expect(parseNotionPageId("https://www.notion.so/acme/Example-12345678123456781234567812345678")).toBe("12345678-1234-5678-1234-567812345678"));
  it("accepts the app.notion.com page URL form", () => expect(parseNotionPageId("https://app.notion.com/p/studyleesh/3d28a265862580699a82c42c405a02e8")).toBe("3d28a265-8625-8069-9a82-c42c405a02e8"));
  it("accepts only the narrow supported configuration surface", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plan-publisher-"));
    const file = path.join(dir, "publisher.yaml");
    await writeFile(file, "parent_url: https://www.notion.so/acme/Example-12345678123456781234567812345678\ninitial_state: In Progress\ndefault_priority: 2\ndefault_labels: [ Build, build, Review ]\n");
    const config = await readConfig(file);
    expect(config.policy.initialState).toBe("In Progress");
    expect(config.policy.defaultLabels).toEqual(["build", "review"]);
  });
  it("rejects misspelled keys and wrong types instead of applying defaults", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plan-publisher-invalid-"));
    const write = async (name: string, contents: string) => { const file = path.join(dir, name); await writeFile(file, contents); return file; };
    const parent = "https://www.notion.so/acme/Example-12345678123456781234567812345678";
    await expect(readConfig(await write("typo.yaml", `parent_url: ${parent}\ninitial_sate: In Progress\n`))).rejects.toThrow(/unsupported key 'initial_sate'/);
    await expect(readConfig(await write("type.yaml", `parent_url: ${parent}\ninitial_state: 123\n`))).rejects.toThrow(/initial_state must be a string/);
    await expect(readConfig(await write("labels.yaml", `parent_url: ${parent}\ndefault_labels: [2]\n`))).rejects.toThrow(/default_labels must be a list of strings/);
  });
  it("rejects canonical property-name collisions", () => {
    expect(() => resolvePolicy({ propertyNames: { title: "Task", identifier: "Task" } })).toThrow(/property_names values must be unique/);
  });
});

describe("policy", () => {
  it("normalizes labels deterministically", () => expect(normalizeLabels([" Build ", "build", "", "Review"])).toEqual(["build", "review"]));
  it("allows only supported initial states and priorities", () => {
    expect(resolvePolicy({ initialState: "In Progress", defaultPriority: 2 }).initialState).toBe("In Progress");
    expect(() => resolvePolicy({ initialState: "Planning" })).toThrow(/unsupported initial_state/);
    expect(() => resolvePolicy({ defaultPriority: 5 })).toThrow(/default_priority/);
  });
});
