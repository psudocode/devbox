import { describe, expect, it } from "vitest";
import type { ToolMeta } from "../tools/types";
import { moveSelection, searchTools } from "./search";

const tools: ToolMeta[] = [
  { id: "json-formatter", name: "JSON Formatter", description: "Prettify and validate", category: "Data & format", keywords: ["prettify", "minify"] },
  { id: "json-diff", name: "JSON Compare", description: "Diff two documents", category: "Data & format", keywords: ["diff"] },
  { id: "base64", name: "Base64", description: "Encode and decode JSON-safe text", category: "Encode / decode / convert" },
  { id: "jwt", name: "JWT Decoder", description: "Inspect tokens", category: "Security", keywords: ["token", "json web token"] },
  { id: "uuid", name: "UUID Generator", description: "Random ids", category: "Security" },
];

const ids = (list: ToolMeta[]) => list.map((t) => t.id);

describe("searchTools", () => {
  it("returns all tools sorted by name for an empty query", () => {
    const expected = ["base64", "json-diff", "json-formatter", "jwt", "uuid"];
    expect(ids(searchTools(tools, ""))).toEqual(expected);
    expect(ids(searchTools(tools, "   "))).toEqual(expected);
  });

  it("is case-insensitive and orders by score, then name", () => {
    expect(ids(searchTools(tools, "JSON"))).toEqual(["json-diff", "json-formatter", "jwt", "base64"]);
  });

  it("ranks name matches above keyword and description matches", () => {
    const result = ids(searchTools(tools, "json"));
    expect(result.indexOf("json-formatter")).toBeLessThan(result.indexOf("jwt")); // name vs keyword
    expect(result.indexOf("jwt")).toBeLessThan(result.indexOf("base64")); // keyword vs description
  });

  it("requires every token to match", () => {
    expect(ids(searchTools(tools, "json diff"))).toEqual(["json-diff"]);
    expect(searchTools(tools, "json uuid")).toEqual([]);
  });

  it("matches keywords and category", () => {
    expect(ids(searchTools(tools, "minify"))).toEqual(["json-formatter"]);
    expect(ids(searchTools(tools, "security")).sort()).toEqual(["jwt", "uuid"]);
  });

  it("matches word starts inside names", () => {
    expect(ids(searchTools(tools, "dec"))[0]).toBe("jwt");
  });

  it("ignores punctuation and diacritics", () => {
    expect(ids(searchTools(tools, "json-diff"))).toEqual(["json-diff"]);
    expect(ids(searchTools(tools, "ûuid"))).toEqual(["uuid"]);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchTools(tools, "zzz")).toEqual([]);
  });
});

describe("moveSelection", () => {
  it("wraps in both directions", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(moveSelection(0, 1, 0)).toBe(-1);
  });
});
