import { describe, expect, it } from "vitest";
import { jsonToToml, sortKeysDeep, tomlToJson } from "./logic";

const toToml = { dropNulls: false };
const toJson = { indent: null, sortKeys: false };

describe("jsonToToml", () => {
  it("converts scalars, tables and arrays", () => {
    const json = '{"title":"devbox","version":1,"pi":3.14,"on":true,"owner":{"name":"Ann"},"tags":["a","b"]}';
    expect(jsonToToml(json, toToml)).toEqual({
      ok: true,
      output: 'title = "devbox"\nversion = 1\npi = 3.14\non = true\ntags = [ "a", "b" ]\n\n[owner]\nname = "Ann"\n',
    });
  });

  it("writes arrays of tables", () => {
    const result = jsonToToml('{"servers":[{"host":"a"},{"host":"b"}]}', toToml);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toContain("[[servers]]");
  });

  it("quotes keys that need it", () => {
    expect(jsonToToml('{"a b":1}', toToml)).toEqual({ ok: true, output: '"a b" = 1\n' });
  });

  it("fails on null, naming the path, unless dropNulls is on", () => {
    const failed = jsonToToml('{"a":{"b":[1,null]}}', toToml);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toContain('"a.b[1]"');

    const failedKey = jsonToToml('{"a":null}', toToml);
    expect(failedKey.ok).toBe(false);

    expect(jsonToToml('{"a":null,"b":[1,null,2],"c":{"d":null,"e":1}}', { dropNulls: true })).toEqual({
      ok: true,
      output: "b = [ 1, 2 ]\n\n[c]\ne = 1\n",
    });
  });

  it("requires an object at the top level", () => {
    for (const json of ["[1,2]", "5", '"x"', "null"]) {
      const result = jsonToToml(json, toToml);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/top level/);
    }
  });

  it("reports invalid JSON", () => {
    const result = jsonToToml("{oops", toToml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Invalid JSON/);
  });
});

describe("tomlToJson", () => {
  it("converts tables, arrays and inline tables", () => {
    const toml = 'title = "devbox"\nports = [80, 443]\n\n[owner]\nname = "Ann"\n\n[[hosts]]\nip = "1.1.1.1"\n\n[[hosts]]\nip = "2.2.2.2"\n';
    expect(tomlToJson(toml, toJson)).toEqual({
      ok: true,
      output: '{"title":"devbox","ports":[80,443],"owner":{"name":"Ann"},"hosts":[{"ip":"1.1.1.1"},{"ip":"2.2.2.2"}]}',
    });
    expect(tomlToJson("p = { x = 1, y = 2 }", toJson)).toEqual({ ok: true, output: '{"p":{"x":1,"y":2}}' });
  });

  it("keeps dates and times as strings", () => {
    const toml = "a = 1979-05-27\nb = 07:32:00\nc = 1979-05-27T07:32:00\nd = 1979-05-27T07:32:00Z\n";
    const result = tomlToJson(toml, toJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = JSON.parse(result.output);
      expect(data.a).toBe("1979-05-27");
      expect(data.b).toMatch(/^07:32:00/);
      expect(data.c).toMatch(/^1979-05-27T07:32:00/);
      expect(data.d).toMatch(/^1979-05-27T07:32:00(\.000)?Z$/);
    }
  });

  it("handles number formats, big integers and inf/nan", () => {
    const toml = "hex = 0xff\nunder = 1_000\nbig = 9223372036854775807\ninf = inf\nnan = nan\nneg = -0.5\n";
    expect(tomlToJson(toml, toJson)).toEqual({
      ok: true,
      output: '{"hex":255,"under":1000,"big":"9223372036854775807","inf":"Infinity","nan":"NaN","neg":-0.5}',
    });
  });

  it("handles multi-line and literal strings", () => {
    const toml = 'a = """\nline1\nline2"""\nb = \'C:\\path\'\n';
    expect(tomlToJson(toml, toJson)).toEqual({ ok: true, output: '{"a":"line1\\nline2","b":"C:\\\\path"}' });
  });

  it("pretty prints and sorts keys", () => {
    expect(tomlToJson("b = 1\na = { z = 1, y = 2 }", { indent: 2, sortKeys: true })).toEqual({
      ok: true,
      output: '{\n  "a": {\n    "y": 2,\n    "z": 1\n  },\n  "b": 1\n}',
    });
    expect(tomlToJson("a = 1", { indent: "tab", sortKeys: false })).toEqual({ ok: true, output: '{\n\t"a": 1\n}' });
  });

  it("returns an empty object for an empty document", () => {
    expect(tomlToJson("# nothing\n", toJson)).toEqual({ ok: true, output: "{}" });
  });

  it("reports errors with line and column", () => {
    const dupe = tomlToJson("a = 1\na = 2\n", toJson);
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.error).toMatch(/^line 2, column \d+: /);

    const syntax = tomlToJson("a = [1, 2\n", toJson);
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) expect(syntax.error).toMatch(/^line \d+, column \d+: /);
  });

  it("round-trips JSON -> TOML -> JSON", () => {
    const original = { name: "x", n: 1, nested: { list: [1, 2, 3], flag: false }, items: [{ a: 1 }, { a: 2 }] };
    const toml = jsonToToml(JSON.stringify(original), toToml);
    expect(toml.ok).toBe(true);
    if (toml.ok) {
      const back = tomlToJson(toml.output, toJson);
      expect(back.ok && JSON.parse(back.output)).toEqual(original);
    }
  });
});

describe("sortKeysDeep", () => {
  it("sorts nested keys and keeps array order", () => {
    expect(JSON.stringify(sortKeysDeep({ b: [2, { y: 1, x: 2 }], a: 1 }))).toBe('{"a":1,"b":[2,{"x":2,"y":1}]}');
  });
});
