import { describe, expect, it } from "vitest";
import { runQuery, type QueryOptions } from "./logic";

const json = '{"items":[{"n":"a","p":5},{"n":"b","p":12}]}';
const jp: QueryOptions = { engine: "jsonpath", query: "$.items[?@.p > 10].n", output: "values", raw: false, indent: null };
const jq: QueryOptions = { engine: "jq", query: ".items[].n", output: "values", raw: false, indent: null };

describe("runQuery / JSONPath", () => {
  it("returns matched values as a JSON array", () => {
    expect(runQuery(json, jp)).toEqual({ ok: true, output: '["b"]', count: 1 });
    expect(runQuery(json, { ...jp, query: "$.items[*].p", indent: 2 })).toEqual({
      ok: true,
      output: "[\n  5,\n  12\n]",
      count: 2,
    });
  });

  it("can return paths, or paths with values", () => {
    expect(runQuery(json, { ...jp, output: "paths" })).toEqual({ ok: true, output: `["$['items'][1]['n']"]`, count: 1 });
    expect(runQuery(json, { ...jp, output: "both" })).toEqual({
      ok: true,
      output: `[{"path":"$['items'][1]['n']","value":"b"}]`,
      count: 1,
    });
  });

  it("returns an empty array when nothing matches", () => {
    expect(runQuery(json, { ...jp, query: "$.nope" })).toEqual({ ok: true, output: "[]", count: 0 });
  });

  it("reports syntax errors", () => {
    const result = runQuery(json, { ...jp, query: "items" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must start with/);
  });
});

describe("runQuery / jq", () => {
  it("prints one result per line", () => {
    expect(runQuery(json, jq)).toEqual({ ok: true, output: '"a"\n"b"', count: 2 });
    expect(runQuery(json, { ...jq, query: ".items[0]", indent: 2 })).toEqual({
      ok: true,
      output: '{\n  "n": "a",\n  "p": 5\n}',
      count: 1,
    });
  });

  it("supports raw string output", () => {
    expect(runQuery(json, { ...jq, raw: true })).toEqual({ ok: true, output: "a\nb", count: 2 });
    expect(runQuery(json, { ...jq, query: ".items[0].p", raw: true })).toEqual({ ok: true, output: "5", count: 1 });
  });

  it("returns no output for empty results", () => {
    expect(runQuery(json, { ...jq, query: "empty" })).toEqual({ ok: true, output: "", count: 0 });
  });

  it("reports runtime errors", () => {
    const result = runQuery(json, { ...jq, query: ".items.n" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cannot index array/);
  });
});

describe("runQuery / shared", () => {
  it("validates the JSON input and the query", () => {
    const badJson = runQuery("{oops", jp);
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.error).toMatch(/^Invalid JSON input/);
    expect(runQuery(json, { ...jp, query: "   " })).toEqual({ ok: false, error: "Enter a query." });
  });

  it("handles very deep data without crashing", () => {
    const deep = "[".repeat(3000) + "]".repeat(3000);
    expect(runQuery(deep, { ...jq, query: "[..] | length" })).toEqual({ ok: true, output: "3000", count: 1 });
    const path = runQuery(deep, { ...jp, query: "$..[?@ == 5]" });
    expect(path).toEqual({ ok: true, output: "[]", count: 0 });
  });

  it("refuses to build a huge output", () => {
    const big = JSON.stringify(Array.from({ length: 6 }, () => "x".repeat(1_000_000)));
    const result = runQuery(big, { ...jq, query: ".[]" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/larger than 5 MB/);
  });
});
