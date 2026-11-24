import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./base64";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("bytesToBase64", () => {
  it("matches RFC 4648 test vectors", () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect(enc("")).toBe("");
    expect(enc("f")).toBe("Zg==");
    expect(enc("fo")).toBe("Zm8=");
    expect(enc("foo")).toBe("Zm9v");
    expect(enc("foob")).toBe("Zm9vYg==");
    expect(enc("fooba")).toBe("Zm9vYmE=");
    expect(enc("foobar")).toBe("Zm9vYmFy");
  });

  it("supports URL-safe output and dropping padding", () => {
    const data = bytes(0xfb, 0xff, 0xfe, 0x01);
    expect(bytesToBase64(data)).toBe("+//+AQ==");
    expect(bytesToBase64(data, { urlSafe: true })).toBe("-__-AQ==");
    expect(bytesToBase64(data, { urlSafe: true, padding: false })).toBe("-__-AQ");
  });

  it("handles large inputs", () => {
    const big = new Uint8Array(300_000).map((_, i) => i % 256);
    const result = base64ToBytes(bytesToBase64(big));
    // Plain loop: toEqual on 300k typed-array elements is itself slow.
    expect(result.ok && result.bytes.length === big.length && result.bytes.every((b, i) => b === big[i])).toBe(true);
  });
});

describe("base64ToBytes", () => {
  const ok = (text: string) => {
    const r = base64ToBytes(text);
    if (!r.ok) throw new Error(r.error);
    return [...r.bytes];
  };
  const err = (text: string) => {
    const r = base64ToBytes(text);
    if (r.ok) throw new Error("expected error");
    return r.error;
  };

  it("decodes standard, URL-safe, unpadded and whitespace-wrapped input", () => {
    expect(ok("+//+AQ==")).toEqual([0xfb, 0xff, 0xfe, 0x01]);
    expect(ok("-__-AQ==")).toEqual([0xfb, 0xff, 0xfe, 0x01]);
    expect(ok("-__-AQ")).toEqual([0xfb, 0xff, 0xfe, 0x01]);
    expect(ok("Zm9v\nYmFy\r\n")).toEqual([...new TextEncoder().encode("foobar")]);
    expect(ok("  Zg  ")).toEqual([0x66]);
  });

  it("treats empty input as empty bytes", () => {
    expect(ok("")).toEqual([]);
    expect(ok("  \n")).toEqual([]);
  });

  it("reports invalid characters with their position", () => {
    expect(err("Zm9v!")).toBe('Invalid character "!" at position 5');
    expect(err("Zm 9v*Z")).toMatch(/"\*" at position 5/); // whitespace is removed before counting
  });

  it("rejects bad padding and impossible lengths", () => {
    expect(err("Zg=g")).toMatch(/only allowed at the end/);
    expect(err("Z===")).toMatch(/Too much/);
    expect(err("Zm9vY")).toMatch(/Invalid length/);
    expect(err("Zg=")).toMatch(/does not match the length/);
  });

  it("rejects mixing both alphabets", () => {
    expect(err("+_")).toMatch(/Mixes/);
  });

  it("round-trips arbitrary bytes", () => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const opts of [{}, { urlSafe: true }, { padding: false }, { urlSafe: true, padding: false }]) {
      const result = base64ToBytes(bytesToBase64(data, opts));
      expect(result.ok && result.bytes).toEqual(data);
    }
  });
});
