import { describe, expect, it } from "vitest";
import { MAX_DEPTH, formatError, formatJson, parseJson, type FormatOptions } from "./logic";

const pretty2: FormatOptions = { indent: 2, sortKeys: false };
const mini: FormatOptions = { indent: null, sortKeys: false };

const ok = (text: string, options: FormatOptions = pretty2) => {
  const result = formatJson(text, options);
  if (!result.ok) throw new Error(`expected valid JSON, got: ${formatError(result.error)}`);
  return result.output;
};

const fail = (text: string) => {
  const result = parseJson(text);
  if (result.ok) throw new Error("expected an error");
  return result.error;
};

describe("prettify", () => {
  it("indents objects and arrays", () => {
    expect(ok('{"a":1,"b":[1,2,{"c":null}]}')).toBe(
      ['{', '  "a": 1,', '  "b": [', '    1,', '    2,', '    {', '      "c": null', '    }', '  ]', '}'].join("\n"),
    );
  });

  it("supports 4 spaces and tabs", () => {
    expect(ok('{"a":[1]}', { indent: 4, sortKeys: false })).toBe('{\n    "a": [\n        1\n    ]\n}');
    expect(ok('{"a":[1]}', { indent: "tab", sortKeys: false })).toBe('{\n\t"a": [\n\t\t1\n\t]\n}');
  });

  it("keeps empty containers compact", () => {
    expect(ok('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}');
    expect(ok("[]")).toBe("[]");
    expect(ok(" { } ")).toBe("{}");
  });

  it("formats scalars at the top level", () => {
    expect(ok("  42 ")).toBe("42");
    expect(ok('"hi"')).toBe('"hi"');
    expect(ok("null")).toBe("null");
    expect(ok("true")).toBe("true");
  });

  it("is idempotent", () => {
    const once = ok('{"a":[1,{"b":2}],"c":"d"}');
    expect(ok(once)).toBe(once);
  });
});

describe("minify", () => {
  it("removes all insignificant whitespace", () => {
    expect(ok('{\n  "a" : [ 1 , 2 ],\n  "b": { "c": "d e" }\n}', mini)).toBe('{"a":[1,2],"b":{"c":"d e"}}');
  });
});

describe("fidelity", () => {
  it("does not change big or precise numbers", () => {
    const text = '[12345678901234567890,0.10000000000000000001,1E400,-0,1.50,2e-3]';
    expect(ok(text, mini)).toBe(text);
  });

  it("keeps string escapes verbatim", () => {
    const text = '{"k":"caf\\u00e9 \\/ \\n \\" \\\\ 🐙"}';
    expect(ok(text, mini)).toBe(text);
  });

  it("keeps duplicate keys", () => {
    expect(ok('{"a":1,"a":2}', mini)).toBe('{"a":1,"a":2}');
  });
});

describe("sort keys", () => {
  it("sorts recursively and leaves arrays in order", () => {
    expect(ok('{"b":1,"a":{"z":1,"y":[{"d":1,"c":2}]}}', { indent: null, sortKeys: true })).toBe(
      '{"a":{"y":[{"c":2,"d":1}],"z":1},"b":1}',
    );
  });

  it("sorts by decoded key and keeps the original escaping", () => {
    expect(ok('{"\\u0062":1,"a":2}', { indent: null, sortKeys: true })).toBe('{"a":2,"\\u0062":1}');
  });

  it("is stable for duplicate keys", () => {
    expect(ok('{"a":2,"b":0,"a":1}', { indent: null, sortKeys: true })).toBe('{"a":2,"a":1,"b":0}');
  });

  it("uses code unit order (uppercase before lowercase)", () => {
    expect(ok('{"b":1,"B":2,"a":3}', { indent: null, sortKeys: true })).toBe('{"B":2,"a":3,"b":1}');
  });
});

describe("validation errors", () => {
  it("reports empty input", () => {
    expect(fail("").message).toBe("Input is empty");
    expect(fail("  \n ").message).toBe("Input is empty");
  });

  it("reports line and column", () => {
    const error = fail('{\n  "a": 1,\n  "b": ?\n}');
    expect(error).toMatchObject({ line: 3, column: 8 });
    expect(error.message).toContain('Unexpected "?"');
    expect(formatError(error)).toMatch(/\(line 3, column 8\)$/);
  });

  it.each([
    ["{", /end of input/],
    ["[1,2", /end of input/],
    ['{"a" 1}', /expected ":"/],
    ['{"a":1,}', /expected a string key/],
    ["[1,]", /expected a JSON value/],
    ["{'a':1}", /expected a string key/],
    ["[1 2]", /expected "," or "\]"/],
    ['{"a":1 "b":2}', /expected "," or "}"/],
    ["[1] x", /after the JSON value/],
    ["{} {}", /after the JSON value/],
    ["nul", /expected a JSON value/],
    ["undefined", /expected a JSON value/],
    ["NaN", /expected a JSON value/],
  ])("rejects %j", (text, message) => {
    expect(fail(text).message).toMatch(message);
  });

  it.each(["01", "-", "-a", "1.", ".5", "+1", "1e", "0x10"])("rejects the number %j", (text) => {
    expect(parseJson(text).ok).toBe(false);
  });

  it("rejects bad strings", () => {
    expect(fail('"abc').message).toBe("Unterminated string");
    expect(fail('"a\nb"').message).toMatch(/Control character/);
    expect(fail('"\\x"').message).toMatch(/Invalid escape/);
    expect(fail('"\\u12G4"').message).toMatch(/\\u escape/);
    expect(fail('"\\').message).toMatch(/Invalid escape/);
  });

  it("accepts valid numbers", () => {
    for (const n of ["0", "-0", "1", "-12.5", "1e5", "1E+5", "1.5e-10"]) expect(parseJson(n).ok).toBe(true);
  });

  it("limits nesting instead of overflowing the stack", () => {
    const deep = "[".repeat(MAX_DEPTH + 10) + "]".repeat(MAX_DEPTH + 10);
    expect(fail(deep).message).toMatch(/deeper than/);
    const fine = "[".repeat(MAX_DEPTH) + "]".repeat(MAX_DEPTH);
    expect(parseJson(fine).ok).toBe(true);
  });

  it("handles large documents", () => {
    const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `item ${i}` })));
    expect(formatJson(big, mini)).toEqual({ ok: true, output: big });
  });

  it("agrees with JSON.parse on what is valid", () => {
    const samples = ['{"a":[1,2,{"b":"c"}]}', "[]", '"x"', "1e3", "[1,]", "{a:1}", "tru", '{"a":}', "  [ 1 ]  "];
    for (const s of samples) {
      let native = true;
      try {
        JSON.parse(s);
      } catch {
        native = false;
      }
      expect(parseJson(s).ok, s).toBe(native);
    }
  });

  it("round-trips like JSON.parse for normal documents", () => {
    const value = { a: [1, 2.5, "x", null, true, { b: [] }], c: "ü\n" };
    const text = JSON.stringify(value);
    expect(JSON.parse(ok(text, pretty2))).toEqual(value);
    expect(ok(text, mini)).toBe(text);
  });
});
