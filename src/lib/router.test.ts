import { describe, expect, it } from "vitest";
import { HOME_HASH, parseHash, toolHash } from "./router";

describe("parseHash", () => {
  it.each(["", "#", "#/", "/"])("treats %j as home", (hash) => {
    expect(parseHash(hash)).toEqual({ name: "home" });
  });

  it("parses a tool route", () => {
    expect(parseHash("#/json-formatter")).toEqual({ name: "tool", toolId: "json-formatter" });
  });

  it("accepts a hash without the slash", () => {
    expect(parseHash("#json-formatter")).toEqual({ name: "tool", toolId: "json-formatter" });
  });

  it("ignores trailing state after the tool id", () => {
    expect(parseHash("#/base64/state")).toEqual({ name: "tool", toolId: "base64" });
  });

  it("extracts shared state from the query", () => {
    expect(parseHash("#/base64?s=abc")).toEqual({ name: "tool", toolId: "base64", state: "abc" });
    expect(parseHash("#/base64?x=1&s=abc_-9")).toEqual({ name: "tool", toolId: "base64", state: "abc_-9" });
    expect(parseHash("#/base64?s=")).toEqual({ name: "tool", toolId: "base64" });
    expect(parseHash("#/base64?x=1")).toEqual({ name: "tool", toolId: "base64" });
  });

  it("decodes percent-encoding and survives malformed escapes", () => {
    expect(parseHash("#/a%20b")).toEqual({ name: "tool", toolId: "a b" });
    expect(parseHash("#/%E0%A4%A")).toEqual({ name: "tool", toolId: "%E0%A4%A" });
  });
});

describe("toolHash", () => {
  it("round-trips through parseHash", () => {
    expect(toolHash("json-formatter")).toBe("#/json-formatter");
    expect(parseHash(toolHash("json-formatter"))).toEqual({ name: "tool", toolId: "json-formatter" });
    expect(parseHash(HOME_HASH)).toEqual({ name: "home" });
  });

  it("appends encoded state and round-trips it", () => {
    expect(toolHash("base64", "abc_-9")).toBe("#/base64?s=abc_-9");
    expect(parseHash(toolHash("base64", "abc_-9"))).toEqual({ name: "tool", toolId: "base64", state: "abc_-9" });
    expect(toolHash("base64", "")).toBe("#/base64");
  });
});
