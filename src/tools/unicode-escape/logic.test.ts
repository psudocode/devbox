import { describe, expect, it } from "vitest";
import { decodeUnicode, describeText, encodeUnicode, type EncodeOptions } from "./logic";

const base: EncodeOptions = { style: "js", scope: "non-ascii", escapeBackslash: true, upper: false };
const enc = (text: string, patch: Partial<EncodeOptions> = {}) => encodeUnicode(text, { ...base, ...patch });

describe("encodeUnicode", () => {
  it("escapes non-ASCII as \\uXXXX with surrogate pairs for astral characters", () => {
    expect(enc("café €")).toBe("caf\\u00e9 \\u20ac");
    expect(enc("🐙")).toBe("\\ud83d\\udc19");
    expect(enc("日本語")).toBe("\\u65e5\\u672c\\u8a9e");
  });

  it("supports other styles", () => {
    expect(enc("é🐙", { style: "es6" })).toBe("\\u{e9}\\u{1f419}");
    expect(enc("é🐙", { style: "python" })).toBe("\\u00e9\\U0001f419");
    expect(enc("é🐙", { style: "css" })).toBe("\\e9 \\1f419 ");
    expect(enc("é🐙", { style: "codepoint" })).toBe("U+00E9 U+1F419");
    expect(enc("é🐙", { style: "percent-u" })).toBe("%u00e9%ud83d%udc19");
  });

  it("can use upper-case hex", () => {
    expect(enc("é🐙", { upper: true })).toBe("\\u00E9\\uD83D\\uDC19");
    expect(enc("é", { style: "es6", upper: true })).toBe("\\u{E9}");
  });

  it("escapes every character in 'all' mode", () => {
    expect(enc("aé\n", { scope: "all" })).toBe("\\u0061\\u00e9\\u000a");
    expect(enc("ab", { scope: "all", style: "codepoint" })).toBe("U+0061 U+0062");
  });

  it("uses short escapes for control characters and escapes backslashes in backslash styles", () => {
    expect(enc("a\tb\nc\r\0")).toBe("a\\tb\\nc\\r\\u0000");
    expect(enc("C:\\dir")).toBe("C:\\\\dir");
    expect(enc("C:\\dir", { escapeBackslash: false })).toBe("C:\\dir");
    expect(enc("C:\\dir", { style: "percent-u" })).toBe("C:\\dir");
  });

  it("keeps a 6-digit CSS escape unspaced and lone ASCII readable", () => {
    expect(enc("\u{10ffff}", { style: "css" })).toBe("\\10ffff");
    expect(enc("abc", { style: "css" })).toBe("abc");
  });
});

describe("decodeUnicode (auto)", () => {
  it("decodes every escape style in one pass", () => {
    const input = "\\u00e9 \\u{1F419} \\U0001F419 \\xe9 U+20AC %u20ac \\ud83d\\udc19";
    expect(decodeUnicode(input, "auto")).toEqual({ text: "é 🐙 🐙 é € € 🐙", warnings: [], count: 8 }); // the surrogate pair is two escapes
  });

  it("decodes short escapes and leaves unknown ones alone", () => {
    expect(decodeUnicode("a\\tb\\nc\\\\d\\'e\\\"f\\/", "auto").text).toBe("a\tb\nc\\d'e\"f/");
    expect(decodeUnicode("\\q \\u12 \\xZZ", "auto")).toEqual({ text: "\\q \\u12 \\xZZ", warnings: [], count: 0 });
  });

  it("does not double-decode an escaped backslash", () => {
    expect(decodeUnicode("\\\\u00e9", "auto").text).toBe("\\u00e9".replace("\\u00e9", "\\") + "u00e9");
  });

  it("warns about code points beyond U+10FFFF and lone surrogates", () => {
    const beyond = decodeUnicode("\\u{110000} \\U00110000 U+110000", "auto");
    expect(beyond.text).toBe("\uFFFD \uFFFD \uFFFD");
    expect(beyond.warnings).toHaveLength(3);
    const lone = decodeUnicode("\\ud83d x", "auto");
    expect(lone.warnings[0]).toMatch(/Lone surrogate U\+D83D at position 0/);
  });

  it("round-trips every style that decode understands", () => {
    const text = "Héllo 🐙 日本\n\tC:\\x \u0000 end";
    for (const style of ["js", "es6", "python", "percent-u"] as const) {
      for (const scope of ["non-ascii", "all"] as const) {
        const encoded = enc(text, { style, scope });
        expect(decodeUnicode(encoded, "auto").text, `${style}/${scope}`).toBe(text);
      }
    }
    // U+XXXX notation is space separated; the separators are dropped when the whole input is such a list.
    expect(decodeUnicode(enc("é🐙", { style: "codepoint" }), "auto").text).toBe("é🐙");
    expect(decodeUnicode("U+0041 U+0042", "auto").text).toBe("AB");
    // ...but spaces in running text are kept.
    expect(decodeUnicode("snowman: U+2603 !", "auto").text).toBe("snowman: ☃ !");
  });
});

describe("decodeUnicode (css)", () => {
  it("decodes CSS escapes with and without the trailing space", () => {
    expect(decodeUnicode("\\e9 t\\e9\\1f419 x \\10ffff", "css")).toEqual({ text: "été🐙x \u{10ffff}", warnings: [], count: 4 });
    expect(decodeUnicode("a\\:b \\.c", "css").text).toBe("a:b .c");
  });

  it("round-trips and flags invalid code points", () => {
    expect(decodeUnicode(enc("é🐙 x", { style: "css", scope: "all" }), "css").text).toBe("é🐙 x");
    const bad = decodeUnicode("\\0 \\d800 \\110000", "css");
    expect(bad.text).toBe("\uFFFD\uFFFD\uFFFD");
    expect(bad.warnings).toHaveLength(3);
  });
});

describe("describeText", () => {
  it("counts code points, UTF-16 units and UTF-8 bytes", () => {
    expect(describeText("a🐙é")).toEqual({ codePoints: 3, utf16Units: 4, utf8Bytes: 7, astral: 1 });
    expect(describeText("")).toEqual({ codePoints: 0, utf16Units: 0, utf8Bytes: 0, astral: 0 });
  });
});
