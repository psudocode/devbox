import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry-core";
import type { ToolMeta } from "./types";

const tool = (id: string, name = id, category: ToolMeta["category"] = "Security"): ToolMeta => ({
  id,
  name,
  description: `${name} tool`,
  category,
});

describe("createRegistry", () => {
  it("looks tools up by id", () => {
    const registry = createRegistry([tool("jwt-decoder"), tool("uuid")]);
    expect(registry.get("uuid")?.id).toBe("uuid");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    expect(() => createRegistry([tool("a"), tool("a")])).toThrow(/Duplicate tool id "a"/);
  });

  it.each(["", "Has Space", "UPPER", "-lead", "trail-", "dou--ble", "slash/y"])(
    "rejects invalid id %j",
    (id) => {
      expect(() => createRegistry([tool(id)])).toThrow(/Invalid tool id/);
    },
  );

  it("accepts slugs with digits and dashes", () => {
    expect(() => createRegistry([tool("base64"), tool("json-to-yaml-2")])).not.toThrow();
  });

  it("groups by category in first-seen order, sorted by name", () => {
    const registry = createRegistry([
      tool("z", "Zeta", "Time"),
      tool("b", "Beta", "Security"),
      tool("a", "Alpha", "Time"),
    ]);
    expect(registry.byCategory().map((g) => [g.category, g.tools.map((t) => t.name)])).toEqual([
      ["Time", ["Alpha", "Zeta"]],
      ["Security", ["Beta"]],
    ]);
  });

  it("handles an empty registry", () => {
    const registry = createRegistry([]);
    expect(registry.tools).toHaveLength(0);
    expect(registry.byCategory()).toEqual([]);
  });
});
