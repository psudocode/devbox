import { describe, expect, it } from "vitest";
import { minifyHtml } from "./html-minify";
import { processCode, type Action, type Language, type Options } from "./logic";

const base: Options = {
  indent: 2,
  keepBlankLines: 1,
  mangle: true,
  compress: true,
  keepLicenseComments: false,
  removeHtmlComments: true,
  minifyInline: true,
};

async function run(language: Language, action: Action, source: string, patch: Partial<Options> = {}) {
  const result = await processCode(language, action, source, { ...base, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function failure(language: Language, action: Action, source: string, patch: Partial<Options> = {}) {
  const result = await processCode(language, action, source, { ...base, ...patch });
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("beautify", () => {
  it("formats JavaScript", async () => {
    const { output } = await run("js", "beautify", "function f(a,b){if(a){return a+b}else{return 0}}\nconst x={a:1,b:[1,2]}");
    expect(output).toBe(
      "function f(a, b) {\n  if (a) {\n    return a + b\n  } else {\n    return 0\n  }\n}\nconst x = {\n  a: 1,\n  b: [1, 2]\n}\n",
    );
  });

  it("formats CSS", async () => {
    const { output } = await run("css", "beautify", "a{color:red;margin:0}b>c,d{padding:1px 2px}");
    expect(output).toBe("a {\n  color: red;\n  margin: 0\n}\n\nb>c,\nd {\n  padding: 1px 2px\n}\n");
  });

  it("formats HTML including inline script and style", async () => {
    const { output } = await run(
      "html",
      "beautify",
      "<div><p>Hi <b>there</b></p><ul><li>a</li><li>b</li></ul><script>var a=1;</script><style>p{color:red}</style></div>",
    );
    expect(output).toBe(
      [
        "<div>",
        "  <p>Hi <b>there</b></p>",
        "  <ul>",
        "    <li>a</li>",
        "    <li>b</li>",
        "  </ul>",
        "  <script>",
        "    var a = 1;",
        "  </script>",
        "  <style>",
        "    p {",
        "      color: red",
        "    }",
        "  </style>",
        "</div>",
        "",
      ].join("\n"),
    );
  });

  it("supports 4-space and tab indents", async () => {
    expect((await run("js", "beautify", "if(a){b()}", { indent: 4 })).output).toBe("if (a) {\n    b()\n}\n");
    expect((await run("js", "beautify", "if(a){b()}", { indent: "tab" })).output).toBe("if (a) {\n\tb()\n}\n");
    expect((await run("css", "beautify", "a{b:c}", { indent: "tab" })).output).toBe("a {\n\tb: c\n}\n");
  });

  it("keeps or removes blank lines", async () => {
    const src = "a();\n\n\n\nb();";
    expect((await run("js", "beautify", src, { keepBlankLines: 1 })).output).toBe("a();\n\nb();\n");
    expect((await run("js", "beautify", src, { keepBlankLines: 0 })).output).toBe("a();\nb();\n");
  });

  it("is idempotent", async () => {
    const once = (await run("js", "beautify", "function f(a,b){return a+b}")).output;
    expect((await run("js", "beautify", once)).output).toBe(once);
  });

  it("reports sizes", async () => {
    const result = await run("css", "beautify", "a{b:c}");
    expect(result.inputBytes).toBe(6);
    expect(result.outputBytes).toBe(result.output.length);
  });

  it("rejects empty input", async () => {
    expect(await failure("js", "beautify", "   ")).toBe("Input is empty.");
  });
});

describe("minify JavaScript", () => {
  const src = "// comment\nfunction add(alpha, beta) {\n  const unused = 1;\n  return alpha + beta;\n}\nconsole.log(add(1, 2));\n";

  it("compresses and mangles, and the result still runs", async () => {
    const { output } = await run("js", "minify", src);
    // Mangled names are chosen by terser, so match the shape rather than the letters.
    expect(output).toMatch(/^function add\((\w),(\w)\)\{return \1\+\2\}console\.log\(add\(1,2\)\);$/);
    expect(new Function(`let out; const console = { log: (v) => (out = v) }; ${output}; return out;`)()).toBe(3);
  });

  it("can keep names and skip compression", async () => {
    const { output } = await run("js", "minify", src, { mangle: false, compress: false });
    expect(output).toContain("function add(alpha,beta)");
    expect(output).toContain("const unused=1");
  });

  it("drops comments except license comments when asked", async () => {
    const withLicense = "/*! (c) me */\n// gone\nfoo();";
    expect((await run("js", "minify", withLicense)).output).toBe("foo();");
    expect((await run("js", "minify", withLicense, { keepLicenseComments: true })).output).toContain("/*! (c) me */");
  });

  it("handles ES modules", async () => {
    const { output } = await run("js", "minify", "import a from './a.js';\nexport const b = a + 1;");
    expect(output).toContain("import a from");
    expect(output).toContain("export");
  });

  it("reports syntax errors with line and column", async () => {
    const error = await failure("js", "minify", "const a = 1;\nfunction ( {\n");
    expect(error).toMatch(/^line 2, column \d+: /);
  });

  it("reports sizes", async () => {
    const result = await run("js", "minify", src);
    expect(result.outputBytes).toBeLessThan(result.inputBytes);
  });
});

describe("minify CSS", () => {
  it("minifies and merges", async () => {
    const { output } = await run("css", "minify", "/* c */\na {\n  color : red ;\n  margin: 0px 0 0 0;\n}\n\nb { color: #ffffff }\n");
    expect(output).toBe("a{color:red;margin:0}b{color:#fff}");
  });

  it("keeps bang comments when asked", async () => {
    const css = "/*! license */\na{b:c}";
    expect((await run("css", "minify", css)).output).toBe("a{b:c}");
    expect((await run("css", "minify", css, { keepLicenseComments: true })).output).toBe("/*! license */\na{b:c}");
  });

  it("warns about CSS it cannot parse instead of hiding it", async () => {
    const result = await run("css", "minify", "a { color: red } @@ b { c: d");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/^line \d+, column \d+: /);
    const clean = await run("css", "minify", "a{b:c}");
    expect(clean.warnings).toEqual([]);
  });
});

describe("minify HTML", () => {
  const plain = { removeComments: true, minifyInline: null };

  it("collapses whitespace around block tags and drops comments", async () => {
    const html = "<!DOCTYPE html>\n<html>\n  <body>\n    <!-- gone -->\n    <div>\n      <p>Hello    world</p>\n    </div>\n  </body>\n</html>\n";
    expect((await minifyHtml(html, plain)).output).toBe("<!DOCTYPE html><html><body><div><p>Hello world</p></div></body></html>");
  });

  it("keeps the single space between inline elements and inside text", async () => {
    expect((await minifyHtml("<p>a <b>b</b> <i>c</i>  d</p>", plain)).output).toBe("<p>a <b>b</b> <i>c</i> d</p>");
    expect((await minifyHtml("<p>  <b>b</b>  </p>", plain)).output).toBe("<p><b>b</b></p>");
    expect((await minifyHtml("<span>a</span>\n<span>b</span>", plain)).output).toBe("<span>a</span> <span>b</span>");
  });

  it("leaves pre and textarea untouched", async () => {
    const html = "<div>\n  <pre>  a\n    b  </pre>\n  <textarea>\n  x  </textarea>\n</div>";
    expect((await minifyHtml(html, plain)).output).toBe("<div><pre>  a\n    b  </pre><textarea>\n  x  </textarea></div>");
  });

  it("keeps conditional comments and can keep all comments", async () => {
    const html = "<!--[if IE]><p>ie</p><![endif]--><!-- x --><p>a</p>";
    expect((await minifyHtml(html, plain)).output).toBe("<!--[if IE]><p>ie</p><![endif]--><p>a</p>");
    expect((await minifyHtml("<!-- x --><p>a</p>", { ...plain, removeComments: false })).output).toBe("<!-- x --><p>a</p>");
  });

  it("normalizes attributes without touching quoted values", async () => {
    const html = `<a   title="a   >  b"\n  href='x  y'   class=big >t</a><br  /><img src="a.png"  />`;
    expect((await minifyHtml(html, plain)).output).toBe(`<a title="a   >  b" href='x  y' class=big>t</a><br/><img src="a.png"/>`);
  });

  it("minifies inline script and style through the callback, and only for known types", async () => {
    const calls: string[] = [];
    const minifyInline = async (kind: "js" | "css", code: string) => {
      calls.push(kind);
      return code.replace(/\s+/g, "");
    };
    const html =
      '<script> var a = 1; </script><script type="application/json"> {"a": 1} </script><style> a { b: c } </style>' +
      '<script type="module"> import x from "y" </script><style media="print"> p { q: r } </style><script src="x.js"></script>';
    const result = await minifyHtml(html, { removeComments: true, minifyInline });
    expect(result.output).toBe(
      '<script>vara=1;</script><script type="application/json"> {"a": 1} </script><style>a{b:c}</style>' +
        '<script type="module">importxfrom"y"</script><style media="print">p{q:r}</style><script src="x.js"></script>',
    );
    expect(calls).toEqual(["js", "css", "js", "css"]);
  });

  it("keeps an inline block and warns when the callback throws", async () => {
    const result = await minifyHtml("<script> bad( </script><p> a </p>", {
      removeComments: true,
      minifyInline: async () => {
        throw new Error("line 1, column 5: Unexpected token");
      },
    });
    expect(result.output).toBe("<script> bad( </script><p>a</p>");
    expect(result.warnings).toEqual(["Left an inline <script> unchanged: line 1, column 5: Unexpected token"]);
  });

  it("does not choke on a stray < or on > inside attributes", async () => {
    expect((await minifyHtml("<p>1 < 2 and 3 > 2</p>", plain)).output).toBe("<p>1 < 2 and 3 > 2</p>");
  });

  it("minifies a whole page end to end, scripts and styles included", async () => {
    const page =
      "<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    body { margin: 0px; color: #ffffff }\n  </style>\n</head>\n" +
      "<body>\n  <h1> Title </h1>\n  <script>\n    function hello(name) { return 'hi ' + name }\n    console.log(hello('x'));\n  </script>\n</body>\n</html>\n";
    const { output, outputBytes, inputBytes, warnings } = await run("html", "minify", page);
    expect(output).toMatch(
      /^<!DOCTYPE html><html><head><style>body\{margin:0;color:#fff\}<\/style><\/head><body><h1>Title<\/h1><script>function hello\((\w)\)\{return"hi "\+\1\}console\.log\(hello\("x"\)\);<\/script><\/body><\/html>$/,
    );
    expect(warnings).toEqual([]);
    expect(outputBytes).toBeLessThan(inputBytes);
    // Without inline minification the script / style bodies stay as written.
    const plainRun = await run("html", "minify", page, { minifyInline: false });
    expect(plainRun.output).toContain("<style>\n    body { margin: 0px; color: #ffffff }\n  </style>");
  });
});
