import { describe, expect, it } from "vitest";
import {
  asciiTable,
  characterTable,
  decodeBytes,
  encodeText,
  formatByteList,
  parseByteList,
  searchAscii,
  type Base,
  type FormatOptions,
} from "./logic";

const text = (s: string) => new TextEncoder().encode(s);
const fmt = (s: string, patch: Partial<FormatOptions> = {}) =>
  formatByteList(text(s), { base: 16, separator: "space", prefix: "none", upper: false, padDecimal: false, ...patch });
const bytesOf = (r: ReturnType<typeof parseByteList>) => {
  if (!r.ok) throw new Error(r.error);
  return Array.from(r.bytes);
};

describe("encodeText / decodeBytes", () => {
  it("encodes UTF-8 and UTF-16", () => {
    expect(Array.from((encodeText("é🐙", "utf-8") as { bytes: Uint8Array }).bytes)).toEqual([0xc3, 0xa9, 0xf0, 0x9f, 0x90, 0x99]);
    expect(Array.from((encodeText("A€", "utf-16le") as { bytes: Uint8Array }).bytes)).toEqual([0x41, 0x00, 0xac, 0x20]);
    expect(Array.from((encodeText("A€", "utf-16be") as { bytes: Uint8Array }).bytes)).toEqual([0x00, 0x41, 0x20, 0xac]);
    expect(Array.from((encodeText("🐙", "utf-16be") as { bytes: Uint8Array }).bytes)).toEqual([0xd8, 0x3d, 0xdc, 0x19]);
  });

  it("encodes Latin-1 and ASCII, and rejects characters that do not fit", () => {
    expect(Array.from((encodeText("é", "latin1") as { bytes: Uint8Array }).bytes)).toEqual([0xe9]);
    expect(encodeText("€", "latin1")).toMatchObject({ ok: false, error: expect.stringContaining("U+20AC") });
    expect(encodeText("é", "ascii")).toMatchObject({ ok: false, error: expect.stringContaining("ASCII") });
    expect(Array.from((encodeText("Hi", "ascii") as { bytes: Uint8Array }).bytes)).toEqual([72, 105]);
  });

  it("decodes every encoding and reports invalid bytes", () => {
    expect(decodeBytes(new Uint8Array([0xc3, 0xa9]), "utf-8")).toEqual({ ok: true, text: "é" });
    expect(decodeBytes(new Uint8Array([0xff, 0xfe]), "utf-8")).toMatchObject({ ok: false });
    expect(decodeBytes(new Uint8Array([0x41, 0x00, 0xac, 0x20]), "utf-16le")).toEqual({ ok: true, text: "A€" });
    expect(decodeBytes(new Uint8Array([0xd8, 0x3d, 0xdc, 0x19]), "utf-16be")).toEqual({ ok: true, text: "🐙" });
    expect(decodeBytes(new Uint8Array([1, 2, 3]), "utf-16le")).toMatchObject({ ok: false, error: expect.stringContaining("even") });
    expect(decodeBytes(new Uint8Array([0xe9]), "latin1")).toEqual({ ok: true, text: "é" });
    expect(decodeBytes(new Uint8Array([0x41, 0xe9]), "ascii")).toMatchObject({ ok: false, error: expect.stringContaining("Byte 2") });
  });

  it("round-trips through every encoding", () => {
    for (const encoding of ["utf-8", "utf-16le", "utf-16be"] as const) {
      const encoded = encodeText("Héllo 🐙 日本", encoding);
      expect(encoded.ok && decodeBytes(encoded.bytes, encoding)).toEqual({ ok: true, text: "Héllo 🐙 日本" });
    }
  });
});

describe("formatByteList", () => {
  it("writes hex, binary, octal and decimal", () => {
    expect(fmt("Hi!")).toBe("48 69 21");
    expect(fmt("Hi!", { upper: true, base: 16 })).toBe("48 69 21");
    expect(fmt("\n\xff", { base: 16, upper: true })).toBe("0A C3 BF");
    expect(fmt("Hi", { base: 2 })).toBe("01001000 01101001");
    expect(fmt("Hi", { base: 8 })).toBe("110 151");
    expect(fmt("A\n", { base: 10 })).toBe("65 10");
    expect(fmt("A\n", { base: 10, padDecimal: true })).toBe("065 010");
  });

  it("supports separators and prefixes", () => {
    expect(fmt("Hi", { separator: "comma", prefix: "0x" })).toBe("0x48, 0x69");
    expect(fmt("Hi", { separator: "none" })).toBe("4869");
    expect(fmt("Hi", { separator: "newline", prefix: "\\x" })).toBe("\\x48\n\\x69");
    expect(fmt("Hi", { separator: "none", prefix: "%" })).toBe("%48%69");
    expect(fmt("", {})).toBe("");
  });
});

describe("parseByteList", () => {
  it("reads separated values in every base", () => {
    expect(bytesOf(parseByteList("48 69 21", 16))).toEqual([0x48, 0x69, 0x21]);
    expect(bytesOf(parseByteList("01001000 01101001", 2))).toEqual([0x48, 0x69]);
    expect(bytesOf(parseByteList("110 151", 8))).toEqual([0x48, 0x69]);
    expect(bytesOf(parseByteList("72, 105; 33\n10", 10))).toEqual([72, 105, 33, 10]);
  });

  it("reads prefixed values", () => {
    expect(bytesOf(parseByteList("0x48, 0x69", 16))).toEqual([0x48, 0x69]);
    expect(bytesOf(parseByteList("\\x48\\x69", 16))).toEqual([0x48, 0x69]);
    expect(bytesOf(parseByteList("%48%69%20", 16))).toEqual([0x48, 0x69, 0x20]);
    expect(bytesOf(parseByteList("0b01001000 0b1", 2))).toEqual([0x48, 1]);
    expect(bytesOf(parseByteList("0o110", 8))).toEqual([0x48]);
  });

  it("reads contiguous hex and binary", () => {
    expect(bytesOf(parseByteList("48656c6c6f", 16))).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(bytesOf(parseByteList("0100100001101001", 2))).toEqual([0x48, 0x69]);
    expect(bytesOf(parseByteList("ff", 16))).toEqual([255]);
    expect(parseByteList("486", 16)).toMatchObject({ ok: false, error: expect.stringContaining("whole bytes") });
  });

  it("does not eat digits that look like a prefix in another base", () => {
    // "0b" is a hex number here, not a binary prefix.
    expect(bytesOf(parseByteList("0b 0a", 16))).toEqual([0x0b, 0x0a]);
    expect(bytesOf(parseByteList("10 0", 10))).toEqual([10, 0]);
  });

  it("reports bad tokens and values over 255", () => {
    expect(parseByteList("48 zz", 16)).toMatchObject({ ok: false, error: '"zz" is not a hex number (item 2).' });
    expect(parseByteList("256", 10)).toMatchObject({ ok: false, error: expect.stringContaining("does not fit in one byte") });
    expect(parseByteList("102", 2)).toMatchObject({ ok: false, error: expect.stringContaining("not a binary number") });
    expect(parseByteList("8", 8)).toMatchObject({ ok: false });
    expect(bytesOf(parseByteList("   ", 16))).toEqual([]);
  });

  it("round-trips formatting and parsing for every base and style", () => {
    const input = text("Héllo 🐙\n");
    for (const base of [16, 2, 8, 10] as Base[]) {
      for (const separator of ["space", "comma", "newline"] as const) {
        const formatted = formatByteList(input, { base, separator, prefix: "none", upper: false, padDecimal: false });
        expect(bytesOf(parseByteList(formatted, base)), `${base}/${separator}`).toEqual(Array.from(input));
      }
    }
    for (const prefix of ["0x", "\\x", "%"] as const) {
      const formatted = formatByteList(input, { base: 16, separator: "none", prefix, upper: true, padDecimal: false });
      expect(bytesOf(parseByteList(formatted, 16)), prefix).toEqual(Array.from(input));
    }
  });
});

describe("asciiTable / searchAscii", () => {
  const rows = asciiTable();

  it("has 128 rows with the usual values", () => {
    expect(rows).toHaveLength(128);
    expect(rows[65]).toMatchObject({ dec: 65, hex: "41", oct: "101", bin: "01000001", char: "A", abbr: "" });
    expect(rows[10]).toMatchObject({ abbr: "LF", char: "", description: "Line feed" });
    expect(rows[32]).toMatchObject({ abbr: "SP", char: " " });
    expect(rows[127]).toMatchObject({ abbr: "DEL", description: "Delete" });
  });

  it("searches by number, hex, character and name", () => {
    expect(searchAscii(rows, "65").map((r) => r.char)).toEqual(["A"]);
    expect(searchAscii(rows, "0x41").map((r) => r.dec)).toEqual([65]);
    expect(searchAscii(rows, "a").map((r) => r.dec)).toEqual([97]);
    expect(searchAscii(rows, "lf").map((r) => r.dec)).toEqual([10]);
    expect(searchAscii(rows, "tab").map((r) => r.abbr)).toEqual(["HT", "VT"]);
    expect(searchAscii(rows, "")).toHaveLength(128);
    expect(searchAscii(rows, "zzzz")).toEqual([]);
  });
});

describe("characterTable", () => {
  it("lists code points with UTF-8 and UTF-16", () => {
    const { rows, total } = characterTable("Aé🐙\n ");
    expect(total).toBe(5);
    expect(rows[0]).toEqual({ display: "A", codePoint: "U+0041", utf8: "41", utf16: "0041", name: "" });
    expect(rows[1]).toEqual({ display: "é", codePoint: "U+00E9", utf8: "C3 A9", utf16: "00E9", name: "" });
    expect(rows[2]).toEqual({ display: "🐙", codePoint: "U+1F419", utf8: "F0 9F 90 99", utf16: "D83D DC19", name: "" });
    expect(rows[3]).toMatchObject({ display: "\u240A", codePoint: "U+000A", name: "Line feed" });
    expect(rows[4]).toMatchObject({ display: "\u2420", codePoint: "U+0020", name: "Space" });
  });

  it("limits the rows but counts everything", () => {
    const { rows, total } = characterTable("x".repeat(500), 50);
    expect(rows).toHaveLength(50);
    expect(total).toBe(500);
  });
});
