// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { detectDelimiter, validateAndFormat, type FormatOptions } from "./logic";

const opts: FormatOptions = { indent: 2, minify: false, csvDelimiter: "auto", csvOutputDelimiter: "same", csvPad: false };

function ok(format: "yaml" | "xml" | "csv", text: string, patch: Partial<FormatOptions> = {}) {
  const result = validateAndFormat(format, text, { ...opts, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result;
}

function fails(format: "yaml" | "xml" | "csv", text: string, patch: Partial<FormatOptions> = {}) {
  const result = validateAndFormat(format, text, { ...opts, ...patch });
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("empty input", () => {
  it("is rejected for every format", () => {
    for (const format of ["yaml", "xml", "csv"] as const) expect(fails(format, "  \n ")).toBe("Input is empty.");
  });
});

describe("YAML", () => {
  it("re-indents and keeps comments", () => {
    const result = ok("yaml", "# top\nname:   devbox\nitems:\n    - a   # first\n    - b\nnested: {x: 1,   y: 2}\n");
    expect(result.output).toBe("# top\nname: devbox\nitems:\n  - a # first\n  - b\nnested: { x: 1, y: 2 }\n");
    expect(result.summary).toBe("Valid YAML · 1 document");
    expect(result.warnings).toEqual([]);
  });

  it("supports a 4-space indent and does not fold long strings", () => {
    const long = "word ".repeat(40).trim();
    const result = ok("yaml", `a:\n  b: ${long}\n`, { indent: 4 });
    expect(result.output).toBe(`a:\n    b: ${long}\n`);
  });

  it("handles multiple documents", () => {
    const result = ok("yaml", "a: 1\n---\nb: 2\n");
    expect(result.output).toBe("a: 1\n---\nb: 2\n");
    expect(result.summary).toBe("Valid YAML · 2 documents");
    expect(ok("yaml", "---\na: 1\n---\nb: 2\n---\nc: 3\n").output).toBe("---\na: 1\n---\nb: 2\n---\nc: 3\n");
    expect(ok("yaml", "a: 1\n---\nplain\n").output).toBe("a: 1\n---\nplain\n");
  });

  it("reports syntax errors with line and column", () => {
    expect(fails("yaml", "a: [1, 2\nb: 3\n")).toMatch(/^line \d+, column \d+: /);
    expect(fails("yaml", "a: 1\na: 2\n")).toMatch(/line 2/);
    expect(fails("yaml", "a: 1\n  b: 2\n")).toMatch(/^line \d+, column \d+: /);
  });

  it("returns unresolved-tag style warnings without failing", () => {
    const result = ok("yaml", "a: !custom 1\n");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/^line 1/);
  });
});

describe("XML", () => {
  it("pretty prints with the chosen indent", () => {
    const result = ok("xml", '<a x="1"><b>1</b><c><d/></c></a>');
    expect(result.output).toBe('<a x="1">\n  <b>1</b>\n  <c>\n    <d/>\n  </c>\n</a>\n');
    expect(result.summary).toBe("Well-formed XML · root <a> · 4 elements");
    expect(ok("xml", "<a><b/></a>", { indent: 4 }).output).toBe("<a>\n    <b/>\n</a>\n");
    expect(ok("xml", "<a><b/></a>", { indent: "tab" }).output).toBe("<a>\n\t<b/>\n</a>\n");
  });

  it("re-indents already formatted input", () => {
    const messy = "<a>\n      <b>1</b>\n\n   <c>2</c>\n</a>";
    expect(ok("xml", messy).output).toBe("<a>\n  <b>1</b>\n  <c>2</c>\n</a>\n");
  });

  it("minifies", () => {
    expect(ok("xml", "<a>\n  <b> x </b>\n  <c/>\n</a>", { minify: true }).output).toBe("<a><b> x </b><c/></a>");
  });

  it("keeps the declaration, comments, CDATA and processing instructions", () => {
    const xml = '<?xml version="1.0"   encoding="UTF-8"?><!-- hi --><?pi data?><a><![CDATA[1 < 2]]><!--c--></a>';
    expect(ok("xml", xml).output).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!-- hi -->\n<?pi data?>\n<a><![CDATA[1 < 2]]><!--c--></a>\n',
    );
  });

  it("keeps mixed content exactly and escapes special characters", () => {
    expect(ok("xml", "<p>Hello <b>big</b> world &amp; <i>all</i></p>").output).toBe(
      "<p>Hello <b>big</b> world &amp; <i>all</i></p>\n",
    );
    expect(ok("xml", '<a t="&quot;x&quot; &lt;"><b>1 &lt; 2</b></a>').output).toBe(
      '<a t="&quot;x&quot; &lt;">\n  <b>1 &lt; 2</b>\n</a>\n',
    );
  });

  it("keeps namespaces and the DOCTYPE", () => {
    const xml = '<!DOCTYPE note SYSTEM "note.dtd"><ns:a xmlns:ns="urn:x"><ns:b/></ns:a>';
    expect(ok("xml", xml).output).toBe('<!DOCTYPE note SYSTEM "note.dtd">\n<ns:a xmlns:ns="urn:x">\n  <ns:b/>\n</ns:a>\n');
  });

  it("rejects malformed XML", () => {
    expect(fails("xml", "<a><b></a>")).toMatch(/^Invalid XML/);
    expect(fails("xml", "just text")).toMatch(/^Invalid XML/);
    expect(fails("xml", "<a></a><b></b>")).toMatch(/^Invalid XML/);
  });

  it("is idempotent", () => {
    const once = ok("xml", '<r a="1"><x>t</x><y><z/>mixed</y></r>').output;
    expect(ok("xml", once).output).toBe(once);
  });
});

describe("CSV", () => {
  it("detects delimiters outside quotes", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c\n1,2,3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"a,b,c";d')).toBe(";");
    expect(detectDelimiter("single")).toBe(",");
  });

  it("normalizes quoting and line endings", () => {
    const result = ok("csv", 'a,"b",c\r\n"x,y","say ""hi""",\r\n');
    expect(result.output).toBe('a,b,c\n"x,y","say ""hi""",\n');
    expect(result.summary).toBe("Valid CSV · 2 rows × 3 columns · comma-separated");
    expect(result.warnings).toEqual([]);
  });

  it("converts the delimiter", () => {
    expect(ok("csv", "a;b\n1;2", { csvOutputDelimiter: "\t" }).output).toBe("a\tb\n1\t2\n");
    expect(ok("csv", "a,b\n\"1;2\",3", { csvOutputDelimiter: ";" }).output).toBe('a;b\n"1;2";3\n');
    expect(ok("csv", "a|b\n1|2", { csvDelimiter: "|" }).summary).toContain("pipe-separated");
  });

  it("warns about rows with the wrong number of fields, with line numbers", () => {
    const result = ok("csv", 'a,b,c\n1,2\n"x\ny",2,3\n4,5,6,7\n');
    expect(result.warnings).toEqual(["Line 2: 2 fields, the first row has 3.", "Line 5: 4 fields, the first row has 3."]);
    expect(result.summary).toMatch(/^Parsed CSV/);
  });

  it("pads short rows when asked", () => {
    expect(ok("csv", "a,b,c\n1\n1,2,3,4", { csvPad: true }).output).toBe("a,b,c,\n1,,,\n1,2,3,4\n");
  });

  it("limits the number of warnings", () => {
    const text = "a,b\n" + Array.from({ length: 30 }, () => "1").join("\n");
    const result = ok("csv", text);
    expect(result.warnings).toHaveLength(21);
    expect(result.warnings[20]).toBe("…and 10 more rows with a different number of fields.");
  });

  it("reports unclosed quotes and stray quotes with a line", () => {
    expect(fails("csv", 'a,b\n1,"2\n')).toMatch(/Line \d+: a quoted field is never closed/);
    expect(fails("csv", 'a,b\n1,2"x"')).toMatch(/Line 2/);
  });
});
