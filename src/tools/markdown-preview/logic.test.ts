import { describe, expect, it } from "vitest";
import { buildPreviewDocument, escapeHtml, isSafeUrl, markdownStats, renderMarkdown, type RenderOptions } from "./logic";

const base: RenderOptions = { gfm: true, breaks: false, allowHtml: false };

function html(md: string, patch: Partial<RenderOptions> = {}): string {
  const result = renderMarkdown(md, { ...base, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result.html;
}

describe("renderMarkdown", () => {
  it("renders common Markdown", () => {
    expect(html("# Title\n\nHello **bold** and *em* and `code`.")).toBe(
      "<h1>Title</h1>\n<p>Hello <strong>bold</strong> and <em>em</em> and <code>code</code>.</p>\n",
    );
    expect(html("- a\n- b\n\n1. x\n2. y")).toContain("<ul>");
    expect(html("> quote")).toContain("<blockquote>");
    expect(html("```js\nlet a = 1 < 2;\n```")).toContain('<code class="language-js">let a = 1 &lt; 2;');
  });

  it("supports GFM tables, task lists and strikethrough, which can be turned off", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~";
    const on = html(md);
    expect(on).toContain("<table>");
    expect(on).toContain('<input checked="" disabled="" type="checkbox">');
    expect(on).toContain("<del>gone</del>");
    expect(html("~~gone~~", { gfm: false })).not.toContain("<del>");
    expect(html("| a |\n|---|\n| 1 |", { gfm: false })).not.toContain("<table>");
  });

  it("handles line breaks", () => {
    expect(html("a\nb")).not.toContain("<br");
    expect(html("a\nb", { breaks: true })).toContain("<br>");
  });

  it("escapes raw HTML unless allowed", () => {
    expect(html("hi <b>there</b>")).toBe("<p>hi &lt;b&gt;there&lt;/b&gt;</p>\n");
    expect(html("<script>alert(1)</script>")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html("<script>alert(1)</script>")).not.toContain("<script>");
    expect(html("hi <b>there</b>", { allowHtml: true })).toBe("<p>hi <b>there</b></p>\n");
  });

  it("drops unsafe link and image URLs but keeps the text", () => {
    expect(html("[x](javascript:alert(1))")).toBe("<p>x</p>\n");
    expect(html("[x](JaVaScRiPt:alert(1))")).toBe("<p>x</p>\n");
    expect(html("[x](vbscript:foo)")).toBe("<p>x</p>\n");
    expect(html("[x](data:text/html,<b>)")).toBe("<p>x</p>\n");
    expect(html("![alt](javascript:alert(1))")).toBe("<p>alt</p>\n");
    expect(html("![alt](data:text/html;base64,AAAA)")).toBe("<p>alt</p>\n");
    expect(html("![alt](file:///etc/passwd)")).toBe("<p>alt</p>\n");
  });

  it("opens safe links safely and keeps titles", () => {
    expect(html('[x](https://example.com/a?b=1&c=2 "T")')).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" title="T" target="_blank" rel="noopener noreferrer">x</a></p>\n',
    );
    expect(html("[m](mailto:a@b.co) [r](/path) [h](#top)")).toContain('href="mailto:a@b.co"');
    expect(html("[r](./rel.md)")).toContain('href="./rel.md"');
    expect(html("<https://example.com>")).toContain('href="https://example.com"');
  });

  it("renders images, including inline data images", () => {
    expect(html("![a b](https://x.test/i.png)")).toBe(
      '<p><img src="https://x.test/i.png" alt="a b" loading="lazy" referrerpolicy="no-referrer"></p>\n',
    );
    expect(html("![d](data:image/png;base64,iVBOR)")).toContain('src="data:image/png;base64,iVBOR"');
  });

  it("escapes attribute values", () => {
    const out = html('[x](https://e.test/"onmouseover="alert(1) "t\\"itle")');
    expect(out).not.toMatch(/onmouseover="/);
  });
});

describe("isSafeUrl", () => {
  it("allows relative URLs and the right schemes", () => {
    for (const url of ["https://a.test", "http://a.test", "mailto:a@b.co", "tel:+62123", "/x", "x/y", "#a", "?q=1", "//cdn.test/x", "page.html"]) {
      expect(isSafeUrl(url, "link"), url).toBe(true);
    }
    expect(isSafeUrl("mailto:a@b.co", "image")).toBe(false);
    expect(isSafeUrl("https://a.test/i.png", "image")).toBe(true);
    expect(isSafeUrl("data:image/png;base64,AA", "image")).toBe(true);
    expect(isSafeUrl("data:image/png;base64,AA", "link")).toBe(false);
  });

  it("rejects schemes hidden by whitespace or control characters", () => {
    for (const url of ["javascript:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:x", "JAVASCRIPT:x", "data:text/html,x", "file:///x", "blob:https://x/y", "vbscript:x"]) {
      expect(isSafeUrl(url, "link"), JSON.stringify(url)).toBe(false);
    }
  });
});

describe("buildPreviewDocument", () => {
  it("blocks scripts and remote requests by default", () => {
    const doc = buildPreviewDocument("<p>x</p>", { dark: false, remoteImages: false });
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("img-src data:\"");
    expect(doc).not.toContain("https:");
    expect(doc).toContain('<body class="light"><p>x</p></body>');
    expect(doc).toContain('<base target="_blank">');
  });

  it("can allow remote images and use the dark style", () => {
    const doc = buildPreviewDocument("", { dark: true, remoteImages: true });
    expect(doc).toContain("img-src data: https: http:");
    expect(doc).toContain('class="dark"');
  });
});

describe("markdownStats", () => {
  it("counts words outside code blocks and lists headings", () => {
    const md = "# Hello *world*\n\nOne two three.\n\n```js\nignore these words here\n```\n\n## Second `part`\nfour";
    const stats = markdownStats(md);
    // "Hello world" (2) + "One two three" (3) + "Second part" (2) + "four" (1); the fenced code block does not count
    expect(stats.words).toBe(2 + 3 + 2 + 1);
    expect(stats.headings).toEqual([
      { depth: 1, text: "Hello world" },
      { depth: 2, text: "Second part" },
    ]);
    expect(stats.readingMinutes).toBe(1);
    expect(stats.characters).toBe(md.length);
  });

  it("handles empty input and long documents", () => {
    expect(markdownStats("")).toEqual({ words: 0, characters: 0, readingMinutes: 0, headings: [] });
    expect(markdownStats("word ".repeat(450)).readingMinutes).toBe(3);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
