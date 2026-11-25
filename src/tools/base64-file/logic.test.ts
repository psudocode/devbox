import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../../lib/base64";
import {
  extensionForMime,
  formatOutput,
  isProbablyText,
  parseBase64Input,
  percentDecodeToBytes,
  sniffMime,
  wrapLines,
} from "./logic";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new TextEncoder().encode(s);

// A real 1x1 transparent PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("sniffMime", () => {
  it("recognizes common binary formats", () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(text("GIF89a...."))).toBe("image/gif");
    expect(sniffMime(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(text("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav");
    expect(sniffMime(text("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0))).toBe("application/zip");
    expect(sniffMime(bytes(0x1f, 0x8b, 8))).toBe("application/gzip");
    expect(sniffMime(text("\0\0\0\x20ftypavif"))).toBe("image/avif");
    expect(sniffMime(text("\0\0\0\x20ftypisom"))).toBe("video/mp4");
    expect(sniffMime(text("wOF2xxxx"))).toBe("font/woff2");
    expect(sniffMime(bytes(0, 0, 1, 0, 1, 0))).toBe("image/x-icon");
  });

  it("recognizes text formats", () => {
    expect(sniffMime(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffMime(text('\uFEFF  <?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
    expect(sniffMime(text("<?xml version='1.0'?><a/>"))).toBe("application/xml");
    expect(sniffMime(text("<!DOCTYPE html><p>x"))).toBe("text/html");
    expect(sniffMime(text("hello, wörld\n"))).toBe("text/plain");
    expect(sniffMime(new Uint8Array(0))).toBe("text/plain");
  });

  it("falls back to octet-stream for unknown binary", () => {
    expect(sniffMime(bytes(1, 2, 3, 4, 5, 250, 251))).toBe("application/octet-stream");
  });
});

describe("isProbablyText", () => {
  it("accepts UTF-8 text and rejects binary", () => {
    expect(isProbablyText(text("héllo\tworld\r\n"))).toBe(true);
    expect(isProbablyText(bytes(0, 1, 2))).toBe(false);
    expect(isProbablyText(bytes(0xff, 0xfe, 0x41))).toBe(false);
  });

  it("tolerates a multi-byte character cut by the 4 KB window", () => {
    const long = new TextEncoder().encode("a".repeat(4095) + "é" + "b".repeat(100));
    expect(isProbablyText(long)).toBe(true);
  });
});

describe("extensionForMime / wrapLines", () => {
  it("maps types to extensions", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("IMAGE/JPEG")).toBe("jpg");
    expect(extensionForMime("text/plain;charset=utf-8")).toBe("txt");
    expect(extensionForMime("application/x-unknown")).toBe("bin");
  });

  it("wraps text at a fixed width", () => {
    expect(wrapLines("abcdefg", 3)).toBe("abc\ndef\ng");
    expect(wrapLines("abc", 0)).toBe("abc");
    expect(wrapLines("", 5)).toBe("");
  });
});

describe("formatOutput", () => {
  const data = text("hello???");

  it("writes plain Base64, URL-safe and wrapped", () => {
    expect(formatOutput(data, "text/plain", "base64", { urlSafe: false, wrap: false })).toBe("aGVsbG8/Pz8=");
    expect(formatOutput(data, "text/plain", "base64", { urlSafe: true, wrap: false })).toBe("aGVsbG8_Pz8=");
    const big = new Uint8Array(100).fill(65);
    const wrapped = formatOutput(big, "text/plain", "base64", { urlSafe: false, wrap: true });
    expect(wrapped.split("\n").map((l) => l.length)).toEqual([76, 60]); // 100 bytes -> 136 Base64 characters
  });

  it("writes data URIs, <img> tags and CSS url()", () => {
    const o = { urlSafe: false, wrap: true };
    expect(formatOutput(data, "text/plain", "data-uri", o)).toBe("data:text/plain;base64,aGVsbG8/Pz8=");
    expect(formatOutput(data, "image/png", "img-tag", o)).toBe('<img src="data:image/png;base64,aGVsbG8/Pz8=" alt="">');
    expect(formatOutput(data, "image/png", "css-url", o)).toBe('url("data:image/png;base64,aGVsbG8/Pz8=")');
  });
});

describe("percentDecodeToBytes", () => {
  it("decodes escapes and keeps non-ASCII as UTF-8", () => {
    expect(Array.from(percentDecodeToBytes("a%20b%2Fc")!)).toEqual(Array.from(text("a b/c")));
    expect(Array.from(percentDecodeToBytes("é🐙")!)).toEqual(Array.from(text("é🐙")));
    expect(percentDecodeToBytes("%zz")).toBeNull();
    expect(percentDecodeToBytes("100%")).toBeNull();
  });
});

describe("parseBase64Input", () => {
  it("parses a base64 data URI and uses the declared type", () => {
    const result = parseBase64Input(`data:image/png;base64,${PNG_B64}`);
    expect(result).toMatchObject({ ok: true, source: "data-uri", declaredMime: "image/png", mime: "image/png", warnings: [] });
    if (result.ok) expect(bytesToBase64(result.bytes)).toBe(PNG_B64);
  });

  it("parses bare Base64 and sniffs the type", () => {
    const result = parseBase64Input(`\n  ${PNG_B64.slice(0, 20)}\n${PNG_B64.slice(20)}  `);
    expect(result).toMatchObject({ ok: true, source: "base64", declaredMime: null, mime: "image/png" });
    const url = parseBase64Input(PNG_B64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
    expect(url).toMatchObject({ ok: true, mime: "image/png" });
  });

  it("parses data URIs without base64 (percent-encoded) and with defaults", () => {
    const result = parseBase64Input("data:text/plain;charset=utf-8,Hello%20W%C3%B6rld");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.bytes)).toBe("Hello Wörld");
      expect(result.mime).toBe("text/plain");
    }
    const bare = parseBase64Input("data:,hi");
    expect(bare).toMatchObject({ ok: true, declaredMime: "text/plain", mime: "text/plain" });
    const svg = parseBase64Input("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E");
    expect(svg).toMatchObject({ ok: true, mime: "image/svg+xml" });
  });

  it("handles %-escaped Base64 payloads and uppercase schemes", () => {
    const result = parseBase64Input("DATA:text/plain;base64,aGVsbG8%3D");
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe("hello");
  });

  it("falls back to the bytes when the declared type is generic, and warns when it is wrong", () => {
    expect(parseBase64Input(`data:application/octet-stream;base64,${PNG_B64}`)).toMatchObject({ ok: true, mime: "image/png", warnings: [] });
    const wrong = parseBase64Input(`data:image/jpeg;base64,${PNG_B64}`);
    expect(wrong).toMatchObject({ ok: true, mime: "image/png" });
    if (wrong.ok) expect(wrong.warnings).toEqual(["The data URI says image/jpeg, but the bytes look like image/png."]);
  });

  it("does not warn when the sniffed type is only a text guess", () => {
    const result = parseBase64Input("data:text/csv;base64,YSxiCjEsMg==");
    expect(result).toMatchObject({ ok: true, mime: "text/csv", warnings: [] });
  });

  it("reports malformed input", () => {
    expect(parseBase64Input("  ")).toEqual({ ok: false, error: "Input is empty." });
    expect(parseBase64Input("data:image/png;base64")).toMatchObject({ ok: false, error: expect.stringContaining('no ","') });
    expect(parseBase64Input("data:text/plain;base64,###")).toMatchObject({ ok: false, error: expect.stringContaining("Invalid Base64 data") });
    expect(parseBase64Input("data:text/plain,%zz")).toMatchObject({ ok: false, error: expect.stringContaining("malformed") });
    expect(parseBase64Input("not base64!")).toMatchObject({ ok: false, error: expect.stringContaining("Invalid character") });
  });
});
