import { describe, expect, it } from "vitest";
import { csvToJson, escapeField, flattenRow, inferType, jsonToCsv, parseCsv } from "./logic";

const toCsv = { delimiter: "," as const, flatten: true, header: true, eol: "\n" as const };
const toJson = { delimiter: "," as const, header: true, typed: true, unflatten: false, indent: null };

describe("escapeField", () => {
  it("quotes only when needed", () => {
    expect(escapeField("plain", ",")).toBe("plain");
    expect(escapeField("a,b", ",")).toBe('"a,b"');
    expect(escapeField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(escapeField("line1\nline2", ",")).toBe('"line1\nline2"');
    expect(escapeField(" padded", ",")).toBe('" padded"');
    expect(escapeField("a,b", ";")).toBe("a,b");
    expect(escapeField("a;b", ";")).toBe('"a;b"');
  });
});

describe("flattenRow", () => {
  it("flattens nested objects with dots and keeps arrays and empty objects", () => {
    expect(flattenRow({ a: { b: 1, c: { d: 2 } }, e: [1, 2], f: {} })).toEqual({
      "a.b": 1,
      "a.c.d": 2,
      e: [1, 2],
      f: {},
    });
  });
});

describe("jsonToCsv", () => {
  it("converts an array of objects", () => {
    const json = '[{"id":1,"name":"Ann"},{"id":2,"name":"Bob, Jr."}]';
    expect(jsonToCsv(json, toCsv)).toEqual({ ok: true, output: 'id,name\n1,Ann\n2,"Bob, Jr."' });
  });

  it("uses the union of keys in first-seen order and leaves gaps empty", () => {
    const json = '[{"a":1},{"b":2,"a":3}]';
    expect(jsonToCsv(json, toCsv)).toEqual({ ok: true, output: "a,b\n1,\n3,2" });
  });

  it("flattens nested objects, or keeps them as JSON text", () => {
    const json = '[{"user":{"name":"Ann"},"tags":["x","y"]}]';
    expect(jsonToCsv(json, toCsv)).toEqual({ ok: true, output: 'user.name,tags\nAnn,"[""x"",""y""]"' });
    expect(jsonToCsv(json, { ...toCsv, flatten: false })).toEqual({
      ok: true,
      output: 'user,tags\n"{""name"":""Ann""}","[""x"",""y""]"',
    });
  });

  it("supports delimiter, no header and CRLF", () => {
    const json = '[{"a":1,"b":"x;y"}]';
    expect(jsonToCsv(json, { delimiter: ";", flatten: true, header: false, eol: "\r\n" })).toEqual({
      ok: true,
      output: '1;"x;y"',
    });
  });

  it("writes null as empty and keeps booleans and numbers", () => {
    expect(jsonToCsv('[{"a":null,"b":true,"c":1.5}]', toCsv)).toEqual({ ok: true, output: "a,b,c\n,true,1.5" });
  });

  it("accepts a single object and an array of arrays", () => {
    expect(jsonToCsv('{"a":1}', toCsv)).toEqual({ ok: true, output: "a\n1" });
    expect(jsonToCsv("[[1,2],[3,4]]", toCsv)).toEqual({ ok: true, output: "1,2\n3,4" });
  });

  it("handles an empty array", () => {
    expect(jsonToCsv("[]", toCsv)).toEqual({ ok: true, output: "" });
  });

  it("rejects scalars in the list and invalid JSON", () => {
    const bad = jsonToCsv("[{\"a\":1}, 5]", toCsv);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Item 1/);
    const invalid = jsonToCsv("{nope", toCsv);
    expect(invalid.ok).toBe(false);
  });
});

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes and embedded newlines", () => {
    const result = parseCsv('a,"b ""q"" c","x\ny"\n1,2,3\n', ",");
    expect(result).toEqual({
      ok: true,
      rows: [
        ["a", 'b "q" c', "x\ny"],
        ["1", "2", "3"],
      ],
    });
  });

  it("handles CRLF, BOM, blank lines and a missing final newline", () => {
    expect(parseCsv("\uFEFFa,b\r\n\r\n1,2", ",")).toEqual({
      ok: true,
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseCsv("a,,c,\n,,", ",")).toEqual({
      ok: true,
      rows: [
        ["a", "", "c", ""],
        ["", "", ""],
      ],
    });
  });

  it("keeps an explicitly quoted empty cell as a row", () => {
    expect(parseCsv('""', ",")).toEqual({ ok: true, rows: [[""]] });
  });

  it("supports other delimiters", () => {
    expect(parseCsv("a;b\tc;d", ";")).toEqual({ ok: true, rows: [["a", "b\tc", "d"]] });
    expect(parseCsv("a\tb", "\t")).toEqual({ ok: true, rows: [["a", "b"]] });
  });

  it("reports an unclosed quote and stray quotes", () => {
    const open = parseCsv('a,"b', ",");
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.error).toMatch(/never closed/);
    const stray = parseCsv('a,b"c"', ",");
    expect(stray.ok).toBe(false);
    const after = parseCsv('"a"x,b', ",");
    expect(after.ok).toBe(false);
  });
});

describe("inferType", () => {
  it("infers numbers, booleans and null", () => {
    expect(inferType("42")).toBe(42);
    expect(inferType("-1.5e3")).toBe(-1500);
    expect(inferType("true")).toBe(true);
    expect(inferType("null")).toBe(null);
  });

  it("keeps ambiguous values as text", () => {
    expect(inferType("007")).toBe("007");
    expect(inferType("1,5")).toBe("1,5");
    expect(inferType("")).toBe("");
    expect(inferType("12345678901234567890")).toBe("12345678901234567890");
    expect(inferType("0x10")).toBe("0x10");
  });
});

describe("csvToJson", () => {
  it("converts rows to objects with typed values", () => {
    expect(csvToJson("id,name,ok\n1,Ann,true\n2,Bob,false\n", toJson)).toEqual({
      ok: true,
      output: '[{"id":1,"name":"Ann","ok":true},{"id":2,"name":"Bob","ok":false}]',
    });
  });

  it("keeps everything as strings when typed is off", () => {
    expect(csvToJson("a\n1", { ...toJson, typed: false })).toEqual({ ok: true, output: '[{"a":"1"}]' });
  });

  it("returns arrays of arrays without a header", () => {
    expect(csvToJson("1,x\n2,y", { ...toJson, header: false })).toEqual({ ok: true, output: '[[1,"x"],[2,"y"]]' });
  });

  it("pads short rows and names blank headers", () => {
    expect(csvToJson("a,,c\n1", toJson)).toEqual({ ok: true, output: '[{"a":1,"column2":"","c":""}]' });
  });

  it("unflattens dotted columns", () => {
    expect(csvToJson("user.name,user.age\nAnn,30", { ...toJson, unflatten: true })).toEqual({
      ok: true,
      output: '[{"user":{"name":"Ann","age":30}}]',
    });
  });

  it("rejects duplicate header names", () => {
    const result = csvToJson("a,a\n1,2", toJson);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Duplicate column name "a"/);
  });

  it("pretty prints and handles header-only input", () => {
    expect(csvToJson("a\n1", { ...toJson, indent: 2 })).toEqual({ ok: true, output: '[\n  {\n    "a": 1\n  }\n]' });
    expect(csvToJson("a,b", toJson)).toEqual({ ok: true, output: "[]" });
    expect(csvToJson("", toJson)).toEqual({ ok: true, output: "[]" });
  });

  it("round-trips JSON -> CSV -> JSON", () => {
    const original = [
      { id: 1, name: 'Ann "A"', note: "x,y\nz" },
      { id: 2, name: "Bob", note: "" },
    ];
    const csv = jsonToCsv(JSON.stringify(original), toCsv);
    expect(csv.ok).toBe(true);
    if (csv.ok) {
      const back = csvToJson(csv.output, toJson);
      expect(back.ok && JSON.parse(back.output)).toEqual(original);
    }
  });
});
