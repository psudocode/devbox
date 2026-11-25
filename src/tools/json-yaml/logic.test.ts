import { describe, expect, it } from "vitest";
import { jsonToYaml, sortKeysDeep, yamlToJson } from "./logic";

const toYaml = { indent: 2 as const, sortKeys: false };

describe("jsonToYaml", () => {
  it("converts objects, arrays and scalars", () => {
    const result = jsonToYaml('{"name":"devbox","tags":["a","b"],"n":1.5,"ok":true,"none":null}', toYaml);
    expect(result).toEqual({
      ok: true,
      output: "name: devbox\ntags:\n  - a\n  - b\nn: 1.5\nok: true\nnone: null\n",
    });
  });

  it("honours indent and sortKeys", () => {
    const result = jsonToYaml('{"b":{"y":1,"x":2},"a":1}', { indent: 4, sortKeys: true });
    expect(result).toEqual({ ok: true, output: "a: 1\nb:\n    x: 2\n    y: 1\n" });
  });

  it("quotes strings that would otherwise change type", () => {
    const result = jsonToYaml('{"a":"true","b":"123","c":"null","d":"x: y"}', toYaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const back = yamlToJson(result.output, { indent: null, sortKeys: false });
      expect(back).toEqual({ ok: true, output: '{"a":"true","b":"123","c":"null","d":"x: y"}' });
    }
  });

  it("does not fold long strings", () => {
    const long = "word ".repeat(40).trim();
    const result = jsonToYaml(JSON.stringify({ long }), toYaml);
    expect(result).toEqual({ ok: true, output: `long: ${long}\n` });
  });

  it("reports invalid JSON", () => {
    const result = jsonToYaml("{oops}", toYaml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Invalid JSON/);
  });
});

describe("yamlToJson", () => {
  it("converts a mapping with nested values", () => {
    const yaml = "name: devbox\nitems:\n  - 1\n  - two\n  - {a: true}\nempty:\n";
    expect(yamlToJson(yaml, { indent: null, sortKeys: false })).toEqual({
      ok: true,
      output: '{"name":"devbox","items":[1,"two",{"a":true}],"empty":null}',
    });
  });

  it("pretty prints with the chosen indent", () => {
    expect(yamlToJson("a: 1", { indent: 4, sortKeys: false })).toEqual({ ok: true, output: '{\n    "a": 1\n}' });
    expect(yamlToJson("a: 1", { indent: "tab", sortKeys: false })).toEqual({ ok: true, output: '{\n\t"a": 1\n}' });
  });

  it("resolves anchors, aliases and merge keys", () => {
    const yaml = "base: &b {x: 1, y: 2}\nchild:\n  <<: *b\n  y: 3\n";
    expect(yamlToJson(yaml, { indent: null, sortKeys: false })).toEqual({
      ok: true,
      output: '{"base":{"x":1,"y":2},"child":{"x":1,"y":3}}',
    });
  });

  it("turns multi-document YAML into an array", () => {
    expect(yamlToJson("a: 1\n---\nb: 2\n", { indent: null, sortKeys: false })).toEqual({
      ok: true,
      output: '[{"a":1},{"b":2}]',
    });
  });

  it("sorts keys deeply when asked", () => {
    expect(yamlToJson("b: {z: 1, y: 2}\na: [ {d: 1, c: 2} ]", { indent: null, sortKeys: true })).toEqual({
      ok: true,
      output: '{"a":[{"c":2,"d":1}],"b":{"y":2,"z":1}}',
    });
  });

  it("makes non-JSON values JSON-safe", () => {
    const result = yamlToJson("a: .inf\nb: .nan\nc: !!set {x, y}\n", { indent: null, sortKeys: false });
    expect(result).toEqual({ ok: true, output: '{"a":"Infinity","b":"NaN","c":["x","y"]}' });
  });

  it("treats an empty document as null", () => {
    expect(yamlToJson("# only a comment\n", { indent: null, sortKeys: false })).toEqual({ ok: true, output: "null" });
  });

  it("reports syntax errors with a position", () => {
    const result = yamlToJson("a: [1, 2\nb: 3\n", { indent: 2, sortKeys: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^line \d+, column \d+: /);
  });

  it("reports duplicate keys", () => {
    const result = yamlToJson("a: 1\na: 2\n", { indent: 2, sortKeys: false });
    expect(result.ok).toBe(false);
  });
});

describe("sortKeysDeep", () => {
  it("sorts nested object keys but keeps array order", () => {
    expect(JSON.stringify(sortKeysDeep({ b: [3, { y: 1, x: 2 }], a: null }))).toBe('{"a":null,"b":[3,{"x":2,"y":1}]}');
  });
});
