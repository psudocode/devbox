import { describe, expect, it } from "vitest";
import { canonicalNumber, diffJson, summarize, type Change } from "./logic";

const ordered = { ignoreArrayOrder: false };
const unordered = { ignoreArrayOrder: true };

const changes = (l: string, r: string, options = ordered): Change[] => {
  const result = diffJson(l, r, options);
  if (!result.ok) throw new Error(`${result.side}: ${result.error}`);
  return result.changes;
};

describe("canonicalNumber", () => {
  it.each([
    ["1", "1e0"],
    ["1.0", "1e0"],
    ["1.50", "15e-1"],
    ["10", "1e1"],
    ["1e1", "1e1"],
    ["0.1e2", "1e1"],
    ["100e-2", "1e0"],
    ["-12.5E+2", "-125e1"],
    ["0", "0"],
    ["-0", "0"],
    ["0.000", "0"],
    ["0e5", "0"],
  ])("%s -> %s", (raw, expected) => {
    expect(canonicalNumber(raw)).toBe(expected);
  });

  it("keeps huge numbers exact", () => {
    expect(canonicalNumber("12345678901234567890")).not.toBe(canonicalNumber("12345678901234567891"));
  });
});

describe("diffJson", () => {
  it("reports no changes for equal documents, ignoring key order and whitespace", () => {
    const result = diffJson('{"a":1,"b":[1,2]}', '{\n "b": [1, 2],\n "a": 1\n}', ordered);
    expect(result).toEqual({ ok: true, changes: [], equal: true });
  });

  it("treats numerically equal numbers and equal escapes as equal", () => {
    expect(changes('{"a":1,"b":"A"}', '{"a":1.0,"b":"\\u0041"}')).toEqual([]);
  });

  it("detects changed, added and removed object keys", () => {
    expect(changes('{"a":1,"b":2,"c":3}', '{"a":1,"b":20,"d":4}')).toEqual([
      { path: "$.b", type: "changed", left: "2", right: "20" },
      { path: "$.c", type: "removed", left: "3" },
      { path: "$.d", type: "added", right: "4" },
    ]);
  });

  it("recurses into nested objects and arrays with JSONPath-style paths", () => {
    expect(changes('{"users":[{"name":"a"},{"name":"b"}]}', '{"users":[{"name":"a"},{"name":"c"}]}')).toEqual([
      { path: "$.users[1].name", type: "changed", left: '"b"', right: '"c"' },
    ]);
  });

  it("quotes keys that are not identifiers", () => {
    expect(changes('{"a b":1,"x-y":{"1":1}}', '{"a b":2,"x-y":{"1":2}}').map((c) => c.path)).toEqual([
      '$["a b"]',
      '$["x-y"]["1"]',
    ]);
  });

  it("compares arrays by position when order matters", () => {
    expect(changes("[1,2,3]", "[1,3]")).toEqual([
      { path: "$[1]", type: "changed", left: "2", right: "3" },
      { path: "$[2]", type: "removed", left: "3" },
    ]);
    expect(changes("[1]", "[1,2]")).toEqual([{ path: "$[1]", type: "added", right: "2" }]);
  });

  it("reports type changes as one change at that path", () => {
    expect(changes('{"a":[1]}', '{"a":{"0":1}}')).toEqual([
      { path: "$.a", type: "changed", left: "[1]", right: '{"0":1}' },
    ]);
    expect(changes('{"a":null}', '{"a":0}')).toEqual([{ path: "$.a", type: "changed", left: "null", right: "0" }]);
    expect(changes('{"a":"1"}', '{"a":1}')).toHaveLength(1);
  });

  it("handles scalar top-level documents", () => {
    expect(changes("1", "2")).toEqual([{ path: "$", type: "changed", left: "1", right: "2" }]);
    expect(changes('"x"', '"x"')).toEqual([]);
  });

  it("lets the last duplicate key win, like JSON.parse", () => {
    expect(changes('{"a":1,"a":2}', '{"a":2}')).toEqual([]);
  });

  it("distinguishes huge numbers that doubles would merge", () => {
    expect(changes("[12345678901234567890]", "[12345678901234567891]")).toHaveLength(1);
  });
});

describe("ignoreArrayOrder", () => {
  it("ignores order, including nested arrays and objects", () => {
    expect(changes('[{"a":[2,1]},3,"x"]', '["x",3,{"a":[1,2]}]', unordered)).toEqual([]);
  });

  it("reports leftovers as removed/added with their own index", () => {
    expect(changes("[1,2,3]", "[3,4,1]", unordered)).toEqual([
      { path: "$[1]", type: "removed", left: "2" },
      { path: "$[1]", type: "added", right: "4" },
    ]);
  });

  it("respects duplicates (multiset semantics)", () => {
    expect(changes("[1,1,2]", "[1,2,2]", unordered)).toEqual([
      { path: "$[1]", type: "removed", left: "1" },
      { path: "$[2]", type: "added", right: "2" },
    ]);
  });

  it("still diffs inside objects", () => {
    expect(changes('{"a":[1,2],"b":1}', '{"a":[2,1],"b":2}', unordered)).toEqual([
      { path: "$.b", type: "changed", left: "1", right: "2" },
    ]);
  });
});

describe("errors and summary", () => {
  it("names the side with invalid JSON", () => {
    const left = diffJson("{", "{}", ordered);
    expect(left).toMatchObject({ ok: false, side: "left" });
    const right = diffJson("{}", "[1,]", ordered);
    expect(right).toMatchObject({ ok: false, side: "right" });
    if (!right.ok) expect(right.error).toMatch(/line 1, column 4/);
  });

  it("counts changes by type", () => {
    expect(summarize(changes('{"a":1,"b":2}', '{"a":2,"c":3}'))).toEqual({ added: 1, removed: 1, changed: 1 });
  });
});
