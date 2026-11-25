// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decodeEntities, encodeEntities, entityName, findUnknownEntities, type EncodeOptions } from "./logic";

const base: EncodeOptions = { scope: "minimal", format: "named", apos: false, upperHex: false };
const enc = (text: string, patch: Partial<EncodeOptions> = {}) => encodeEntities(text, { ...base, ...patch });

describe("encodeEntities", () => {
  it("escapes the five special characters", () => {
    expect(enc(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
    expect(enc("it's", { apos: true })).toBe("it&apos;s");
  });

  it("leaves everything else alone in minimal mode", () => {
    expect(enc("café © 🐙 €")).toBe("café © 🐙 €");
  });

  it("encodes non-ASCII as names where they exist, numbers otherwise", () => {
    expect(enc("café © € — “q” × ≠", { scope: "non-ascii" })).toBe("caf&eacute; &copy; &euro; &mdash; &ldquo;q&rdquo; &times; &ne;");
    expect(enc("🐙 ☃", { scope: "non-ascii" })).toBe("&#128025; &#9731;");
    expect(enc("α β Ω", { scope: "non-ascii" })).toBe("&alpha; &beta; &Omega;");
  });

  it("supports decimal and hex output", () => {
    expect(enc("é🐙", { scope: "non-ascii", format: "decimal" })).toBe("&#233;&#128025;");
    expect(enc("é🐙", { scope: "non-ascii", format: "hex" })).toBe("&#xe9;&#x1f419;");
    expect(enc("é🐙", { scope: "non-ascii", format: "hex", upperHex: true })).toBe("&#xE9;&#x1F419;");
  });

  it("keeps printable ASCII and line breaks in non-ascii mode, escapes control characters", () => {
    expect(enc("a b\n\tc~", { scope: "non-ascii" })).toBe("a b\n\tc~");
    expect(enc("a\u0001b\u007f", { scope: "non-ascii", format: "decimal" })).toBe("a&#1;b&#127;");
  });

  it("encodes everything but letters and digits in 'all' mode", () => {
    expect(enc("a-b, c!", { scope: "all", format: "decimal" })).toBe("a&#45;b&#44; c&#33;");
    expect(enc("a-b", { scope: "all", format: "hex" })).toBe("a&#x2d;b");
  });

  it("handles astral characters as one code point", () => {
    expect(enc("𝒳", { scope: "non-ascii", format: "decimal" })).toBe("&#119987;");
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("&lt;p&gt; &amp; &quot;x&quot; &#39;y&#39; &apos;z&apos;")).toBe(`<p> & "x" 'y' 'z'`);
    expect(decodeEntities("&copy; &#169; &#xA9; &#xa9; &euro; &hearts; &#128025; &#x1F419;")).toBe("© © © © € ♥ 🐙 🐙");
    expect(decodeEntities("&nbsp;")).toBe(" ");
  });

  it("knows the full HTML5 entity list", () => {
    expect(decodeEntities("&NotEqualTilde; &bigstar; &fjlig;")).toBe("≂̸ ★ fj");
  });

  it("does not touch tags or text, and does not run markup", () => {
    expect(decodeEntities("<b>bold</b> &amp; <script>alert(1)</script>")).toBe("<b>bold</b> & <script>alert(1)</script>");
    expect(decodeEntities("</textarea><img src=x onerror=alert(1)>")).toBe("</textarea><img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });

  it("decodes only once, leaving double-encoded text one level encoded", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown or malformed entities as written", () => {
    expect(decodeEntities("&bogus; & &#; &#xZZ;")).toBe("&bogus; & &#; &#xZZ;");
  });

  it("decodes legacy entities without a semicolon like a browser does", () => {
    // "&not" is a legacy entity, so "&notanentity;" starts with the not sign.
    expect(decodeEntities("&notanentity; &copy 2024")).toBe("¬anentity; © 2024");
  });

  it("round-trips through every encoding", () => {
    const text = `Tom & Jerry's "café" <3 — 🐙 α≠β`;
    for (const scope of ["minimal", "non-ascii", "all"] as const) {
      for (const format of ["named", "decimal", "hex"] as const) {
        expect(decodeEntities(enc(text, { scope, format })), `${scope}/${format}`).toBe(text);
      }
    }
  });
});

describe("findUnknownEntities", () => {
  it("lists entities a browser would not decode", () => {
    expect(findUnknownEntities("&amp; &bogus; &#xZZ; &#99999999; &#0; &#xD800; &#xFFFD; &copy;")).toEqual([
      "&bogus;",
      "&#99999999;",
      "&#0;",
      "&#xD800;",
    ]);
    expect(findUnknownEntities("nothing here")).toEqual([]);
  });
});

describe("entityName", () => {
  it("looks up names by code point", () => {
    expect(entityName(0xa9)).toBe("copy");
    expect(entityName(0xff)).toBe("yuml");
    expect(entityName(0x20ac)).toBe("euro");
    expect(entityName(0x3c3)).toBe("sigma");
    expect(entityName(0x41)).toBeUndefined();
  });
});
