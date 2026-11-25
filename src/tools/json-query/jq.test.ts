import { describe, expect, it } from "vitest";
import { compareValues, JqError, runJq } from "./jq";

const run = (data: unknown, program: string) => runJq(data, program);

const users = [
  { name: "Ann", age: 31, tags: ["a", "b"], active: true },
  { name: "Bob", age: 25, tags: [], active: false },
  { name: "Cy", age: 40, tags: ["b"], active: true },
];

describe("paths", () => {
  it("identity and field access", () => {
    expect(run({ a: 1 }, ".")).toEqual([{ a: 1 }]);
    expect(run({ a: { b: 2 } }, ".a.b")).toEqual([2]);
    expect(run({ "a b": 1 }, '."a b"')).toEqual([1]);
    expect(run({ "a b": 1 }, '.["a b"]')).toEqual([1]);
    expect(run({ a: 1 }, ".missing")).toEqual([null]);
    expect(run(null, ".a.b")).toEqual([null]);
    expect(run({ a: { b: 1 } }, ".a | .b")).toEqual([1]);
  });

  it("array indexes and slices", () => {
    expect(run([1, 2, 3], ".[0]")).toEqual([1]);
    expect(run([1, 2, 3], ".[-1]")).toEqual([3]);
    expect(run([1, 2, 3], ".[9]")).toEqual([null]);
    expect(run([1, 2, 3, 4], ".[1:3]")).toEqual([[2, 3]]);
    expect(run([1, 2, 3, 4], ".[:2]")).toEqual([[1, 2]]);
    expect(run([1, 2, 3, 4], ".[-2:]")).toEqual([[3, 4]]);
    expect(run("abcdef", ".[1:3]")).toEqual(["bc"]);
  });

  it("iteration", () => {
    expect(run([1, 2], ".[]")).toEqual([1, 2]);
    expect(run({ a: 1, b: 2 }, ".[]")).toEqual([1, 2]);
    expect(run(users, ".[].name")).toEqual(["Ann", "Bob", "Cy"]);
    expect(run({ list: [{ x: 1 }, { x: 2 }] }, ".list[].x")).toEqual([1, 2]);
    expect(() => run(5, ".[]")).toThrow(/Cannot iterate over number/);
  });

  it("recursive descent", () => {
    expect(run({ a: [1, { b: 2 }] }, ".. | numbers")).toEqual([1, 2]);
    expect(run({ a: { b: 1 } }, "[..] | length")).toEqual([3]);
  });

  it("optional operator suppresses errors", () => {
    expect(run([1, "x"], ".[] | .a?")).toEqual([]);
    expect(run(5, ".[]?")).toEqual([]);
    expect(run({ a: 1 }, ".a.b?")).toEqual([]);
  });

  it("reports indexing errors", () => {
    expect(() => run({ a: 1 }, ".a.b")).toThrow(/Cannot index number with "b"/);
    expect(() => run([1], ".a")).toThrow(/Cannot index array with "a"/);
  });
});

describe("operators", () => {
  it("pipes and commas", () => {
    expect(run({ a: 1, b: 2 }, ".a, .b")).toEqual([1, 2]);
    expect(run([1, 2, 3], ".[] | . * 2")).toEqual([2, 4, 6]);
    expect(run({ a: [1, 2] }, ".a | length")).toEqual([2]);
  });

  it("arithmetic", () => {
    expect(run(null, "1 + 2 * 3")).toEqual([7]);
    expect(run(null, "(1 + 2) * 3")).toEqual([9]);
    expect(run(null, "10 / 4")).toEqual([2.5]);
    expect(run(null, "10 % 3")).toEqual([1]);
    expect(run(null, "-(1 + 2)")).toEqual([-3]);
    expect(run(null, '"a" + "b"')).toEqual(["ab"]);
    expect(run(null, "[1] + [2]")).toEqual([[1, 2]]);
    expect(run(null, "null + 1")).toEqual([1]);
    expect(run(null, '{a:1} + {b:2}')).toEqual([{ a: 1, b: 2 }]);
    expect(run(null, '{a:{b:1}} * {a:{c:2}}')).toEqual([{ a: { b: 1, c: 2 } }]);
    expect(run(null, '"ab" * 2')).toEqual(["abab"]);
    expect(run(null, '"a,b" / ","')).toEqual([["a", "b"]]);
    expect(run(null, "[1,2,3,2] - [2]")).toEqual([[1, 3]]);
    expect(() => run(null, "1 / 0")).toThrow(/divisor is zero/);
    expect(() => run(null, '1 + "a"')).toThrow(/cannot be added/);
  });

  it("comparison follows jq ordering", () => {
    expect(run(null, "1 < 2, 2 <= 2, 3 > 4, 1 == 1, 1 != 1")).toEqual([true, true, false, true, false]);
    expect(run(null, '"a" < "b"')).toEqual([true]);
    expect(run(null, "null < false, false < true, true < 0, 0 < \"a\", \"a\" < [], [] < {}")).toEqual([true, true, true, true, true, true]);
    expect(run(null, "[1,2] == [1,2], {a:1} == {a:1}")).toEqual([true, true]);
    expect(compareValues({ a: 1 }, { a: 2 })).toBe(-1);
    expect(compareValues([1, 2], [1])).toBe(1);
  });

  it("and / or / not / alternative", () => {
    expect(run(null, "(true and false), (true or false), ((true and true) | not)")).toEqual([false, true, false]);
    // `|` binds loosest, so this negates every output of the comma expression.
    expect(run(null, "true and false, true or false | not")).toEqual([true, false]);
    expect(run({ a: null }, ".a // 5")).toEqual([5]);
    expect(run({ a: 0 }, ".a // 5")).toEqual([0]);
    expect(run({ a: false }, ".a // .b // 7")).toEqual([7]);
    expect(run(5, ".a? // \"fallback\"")).toEqual(["fallback"]);
  });

  it("if / elif / else", () => {
    const program = 'if . < 0 then "neg" elif . == 0 then "zero" else "pos" end';
    expect([-1, 0, 5].flatMap((n) => run(n, program))).toEqual(["neg", "zero", "pos"]);
    expect(run(5, "if . > 3 then \"big\" end")).toEqual(["big"]);
    expect(run(1, "if . > 3 then \"big\" end")).toEqual([1]);
  });
});

describe("construction", () => {
  it("arrays", () => {
    expect(run([1, 2, 3], "[.[] | . * 2]")).toEqual([[2, 4, 6]]);
    expect(run(null, "[]")).toEqual([[]]);
    expect(run(users, "[.[] | select(.active) | .name]")).toEqual([["Ann", "Cy"]]);
  });

  it("objects, with shorthand, computed keys and string keys", () => {
    expect(run({ a: 1, b: 2, c: 3 }, "{a, b}")).toEqual([{ a: 1, b: 2 }]);
    expect(run({ a: 1 }, '{x: .a, "y z": (.a + 1)}')).toEqual([{ x: 1, "y z": 2 }]);
    expect(run({ k: "name", v: 1 }, "{(.k): .v}")).toEqual([{ name: 1 }]);
    expect(run(users, ".[] | {name, adult: (.age >= 30)}")).toEqual([
      { name: "Ann", adult: true },
      { name: "Bob", adult: false },
      { name: "Cy", adult: true },
    ]);
    expect(run({ a: [1, 2] }, "{b: .a[]}")).toEqual([{ b: 1 }, { b: 2 }]);
    expect(run({ a: [1, 2] }, "{b: .a | length}")).toEqual([{ b: 2 }]);
    expect(run(null, "{}")).toEqual([{}]);
  });

  it("string interpolation", () => {
    expect(run({ name: "Ann", n: 2 }, '"Hi \\(.name), you have \\(.n + 1) items"')).toEqual(["Hi Ann, you have 3 items"]);
    expect(run({ a: [1] }, '"v=\\(.a)"')).toEqual(["v=[1]"]);
    expect(run(null, '"tab\\there \\u00e9 \\"q\\""')).toEqual(['tab\there é "q"']);
  });
});

describe("builtins", () => {
  it("select and map", () => {
    expect(run(users, "map(select(.age > 30) | .name)")).toEqual([["Ann", "Cy"]]);
    expect(run([1, 2, 3], "map(. + 1)")).toEqual([[2, 3, 4]]);
    expect(run({ a: 1, b: 2 }, "map_values(. * 10)")).toEqual([{ a: 10, b: 20 }]);
    expect(run(users, "[.[] | select(.name | startswith(\"B\"))] | length")).toEqual([1]);
  });

  it("length, keys, values, has, type", () => {
    expect(run("héllo", "length")).toEqual([5]);
    expect(run([1, 2], "length")).toEqual([2]);
    expect(run({ a: 1 }, "length")).toEqual([1]);
    expect(run(null, "length")).toEqual([0]);
    expect(run({ b: 1, a: 2 }, "keys")).toEqual([["a", "b"]]);
    expect(run({ b: 1, a: 2 }, "keys_unsorted")).toEqual([["b", "a"]]);
    expect(run([5, 6], "keys")).toEqual([[0, 1]]);
    expect(run({ a: 1 }, 'has("a"), has("b")')).toEqual([true, false]);
    expect(run([1, 2], "has(1), has(2)")).toEqual([true, false]);
    expect(run([1, "a", null, [], {}, true], ".[] | type")).toEqual(["number", "string", "null", "array", "object", "boolean"]);
    expect(run([1, null, 2], "[.[] | values]")).toEqual([[1, 2]]);
  });

  it("add, any, all, flatten, range, min, max", () => {
    expect(run([1, 2, 3], "add")).toEqual([6]);
    expect(run(["a", "b"], "add")).toEqual(["ab"]);
    expect(run([], "add")).toEqual([null]);
    expect(run(users, "map(.age) | add / length")).toEqual([(31 + 25 + 40) / 3]);
    expect(run([true, false], "any, all")).toEqual([true, false]);
    expect(run(users, "any(.age > 35), all(.age > 30)")).toEqual([true, false]);
    expect(run([1, [2, [3]]], "flatten")).toEqual([[1, 2, 3]]);
    expect(run([1, [2, [3]]], "flatten(1)")).toEqual([[1, 2, [3]]]);
    expect(run(null, "[range(3)]")).toEqual([[0, 1, 2]]);
    expect(run(null, "[range(2; 5)]")).toEqual([[2, 3, 4]]);
    expect(run([3, 1, 2], "min, max")).toEqual([1, 3]);
    expect(run([], "min")).toEqual([null]);
    expect(run(users, "min_by(.age).name, max_by(.age).name")).toEqual(["Bob", "Cy"]);
  });

  it("sorting and grouping", () => {
    expect(run([3, 1, 2], "sort")).toEqual([[1, 2, 3]]);
    expect(run(["b", "a"], "sort")).toEqual([["a", "b"]]);
    expect(run(users, "sort_by(.age) | map(.name)")).toEqual([["Bob", "Ann", "Cy"]]);
    expect(run(users, "group_by(.active) | map(map(.name))")).toEqual([[["Bob"], ["Ann", "Cy"]]]);
    expect(run([1, 2, 1, 3, 2], "unique")).toEqual([[1, 2, 3]]);
    expect(run(users, "unique_by(.active) | map(.name)")).toEqual([["Bob", "Ann"]]);
    expect(run([1, 2, 3], "reverse")).toEqual([[3, 2, 1]]);
    expect(run("abc", "reverse")).toEqual(["cba"]);
  });

  it("first, last, limit", () => {
    expect(run([1, 2, 3], "first, last")).toEqual([1, 3]);
    expect(run([1, 2, 3], "first(.[] | select(. > 1))")).toEqual([2]);
    expect(run([1, 2, 3, 4], "[limit(2; .[])]")).toEqual([[1, 2]]);
    expect(run(null, "[limit(0; 1, 2)]")).toEqual([[]]);
    expect(run(null, "first(range(1000000000))")).toEqual([0]);
  });

  it("strings", () => {
    expect(run("a,b,c", 'split(",")')).toEqual([["a", "b", "c"]]);
    expect(run(["a", 1, null, true], 'join("-")')).toEqual(["a-1--true"]);
    expect(run("Hello", "ascii_downcase, ascii_upcase")).toEqual(["hello", "HELLO"]);
    expect(run("foobar", 'startswith("foo"), endswith("bar"), ltrimstr("foo"), rtrimstr("bar")')).toEqual([true, true, "bar", "foo"]);
    expect(run("abc123", 'test("\\\\d+"), test("ABC"), test("ABC"; "i")')).toEqual([true, false, true]);
    expect(run([1, "a"], "map(tostring)")).toEqual([["1", "a"]]);
    expect(run("42", "tonumber")).toEqual([42]);
    expect(() => run("x", "tonumber")).toThrow(/cannot be parsed as a number/);
    expect(run({ a: 1 }, "tojson")).toEqual(['{"a":1}']);
    expect(run('{"a":1}', "fromjson")).toEqual([{ a: 1 }]);
    expect(run({ a: "foobar" }, 'contains({a: "oba"})')).toEqual([true]);
    expect(run("foo", 'inside("foobar")')).toEqual([true]);
    expect(run([1, 2, 3], "contains([1])")).toEqual([true]);
  });

  it("numbers", () => {
    expect(run(2.5, "floor, ceil, round")).toEqual([2, 3, 3]);
    expect(run(16, "sqrt")).toEqual([4]);
    expect(run(-3, "abs")).toEqual([3]);
  });

  it("entries", () => {
    expect(run({ a: 1, b: 2 }, "to_entries")).toEqual([[{ key: "a", value: 1 }, { key: "b", value: 2 }]]);
    expect(run([{ key: "a", value: 1 }, { name: "b", v: 2 }], "from_entries")).toEqual([{ a: 1, b: 2 }]);
    expect(run({ a: 1, b: 2 }, 'with_entries(select(.value > 1))')).toEqual([{ b: 2 }]);
    expect(run({ a: 1 }, 'with_entries({key: (.key + "_x"), value: (.value + 1)})')).toEqual([{ a_x: 2 }]);
  });

  it("empty and recurse", () => {
    expect(run([1, 2], "[.[] | empty]")).toEqual([[]]);
    expect(run({ a: [1] }, "[recurse | numbers]")).toEqual([[1]]);
    expect(run(2, "[recurse(if . < 20 then . * . else empty end)]")).toEqual([[2, 4, 16, 256]]);
  });

  it("typical real-world queries", () => {
    const data = { items: users };
    expect(run(data, ".items | map(select(.tags | contains([\"b\"]))) | map(.name)")).toEqual([["Ann", "Cy"]]);
    expect(run(data, '.items[] | select(.age > 30) | "\\(.name) (\\(.age))"')).toEqual(["Ann (31)", "Cy (40)"]);
    expect(run(data, "[.items[].tags[]] | unique")).toEqual([["a", "b"]]);
    expect(run(data, ".items | map({(.name): .age}) | add")).toEqual([{ Ann: 31, Bob: 25, Cy: 40 }]);
  });
});

describe("errors and limits", () => {
  const message = (program: string) => {
    try {
      runJq({ a: 1 }, program);
    } catch (err) {
      if (err instanceof JqError) return err.message;
      throw err;
    }
    return null;
  };

  it("reports syntax errors", () => {
    expect(message(".a |")).toMatch(/Unexpected end of query/);
    expect(message(".a )")).toMatch(/Unexpected/);
    expect(message("[1, 2")).toMatch(/Expected "\]"/);
    expect(message("{a: }")).toMatch(/Unexpected/);
    expect(message('"abc')).toMatch(/Unterminated string/);
    expect(message("if . then 1")).toMatch(/Expected "end"/);
    expect(message("1 +")).toMatch(/Unexpected end/);
  });

  it("explains unsupported features", () => {
    expect(message(". as $x | $x")).toMatch(/Variables/);
    expect(message("$x")).toMatch(/Variables/);
    expect(message("reduce .[] as $x (0; . + $x)")).toMatch(/not supported|Variables/);
    expect(message("def f: 1; f")).toMatch(/not supported/);
    expect(message("@base64")).toMatch(/@formats/);
    expect(message("nope")).toMatch(/nope\/0 is not defined/);
    expect(message("map(1; 2)")).toMatch(/map\/2 is not defined/);
  });

  it("stops runaway queries", () => {
    expect(() => runJq(null, "[range(100000000)] | length")).toThrow(/too long|More than/);
    expect(() => runJq(null, "range(20000)")).toThrow(/More than 10000 results/);
  });

  it("treats an empty program as identity", () => {
    expect(runJq({ a: 1 }, "  ")).toEqual([{ a: 1 }]);
    expect(runJq({ a: 1 }, "# just a comment")).toEqual([{ a: 1 }]);
    expect(runJq({ a: 1 }, ".a # trailing comment")).toEqual([1]);
  });
});
