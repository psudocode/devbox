import { describe, expect, it } from "vitest";
import {
  applyBitOp,
  bigIntToBytes,
  bytesToBigInt,
  bytesToHex,
  decodeFlags,
  encodeFlags,
  endianness,
  groupBinary,
  parseFlagDefinitions,
  parseHexBytes,
  parseInteger,
  setBits,
  twosComplement,
} from "./logic";

const int = (s: string) => {
  const r = parseInteger(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe("parseInteger", () => {
  it("reads every notation, signs and separators", () => {
    expect(int("42")).toBe(42n);
    expect(int("-42")).toBe(-42n);
    expect(int("+7")).toBe(7n);
    expect(int("0xFF")).toBe(255n);
    expect(int("-0x80")).toBe(-128n);
    expect(int("0b1010_1010")).toBe(170n);
    expect(int("0o777")).toBe(511n);
    expect(int(" 1 000 000 ")).toBe(1000000n);
    expect(int("340282366920938463463374607431768211455")).toBe(2n ** 128n - 1n);
  });

  it("rejects everything else", () => {
    for (const bad of ["", "abc", "1.5", "0xZZ", "0b12", "--1", "1e3"]) expect(parseInteger(bad).ok, bad).toBe(false);
  });
});

describe("twosComplement", () => {
  it("handles the classic 8-bit cases", () => {
    expect(twosComplement(-1n, 8)).toMatchObject({ unsigned: 255n, signed: -1n, binary: "11111111", hex: "FF", fits: true });
    expect(twosComplement(-128n, 8)).toMatchObject({ unsigned: 128n, signed: -128n, binary: "10000000", hex: "80", fits: true });
    expect(twosComplement(127n, 8)).toMatchObject({ unsigned: 127n, signed: 127n, binary: "01111111" });
    expect(twosComplement(255n, 8)).toMatchObject({ unsigned: 255n, signed: -1n, fits: true });
    expect(twosComplement(0n, 8)).toMatchObject({ unsigned: 0n, signed: 0n, binary: "00000000", hex: "00" });
  });

  it("reports the ranges", () => {
    const t = twosComplement(5n, 16);
    expect(t).toMatchObject({ minSigned: -32768n, maxSigned: 32767n, maxUnsigned: 65535n });
  });

  it("wraps and flags values that do not fit", () => {
    expect(twosComplement(256n, 8)).toMatchObject({ unsigned: 0n, signed: 0n, fits: false });
    expect(twosComplement(-129n, 8)).toMatchObject({ unsigned: 127n, signed: 127n, fits: false });
    expect(twosComplement(300n, 8)).toMatchObject({ unsigned: 44n, fits: false });
  });

  it("shows the by-hand steps for negative numbers", () => {
    expect(twosComplement(-5n, 8).steps).toEqual({ absolute: "00000101", inverted: "11111010", plusOne: "11111011" });
    expect(twosComplement(5n, 8).steps).toBeNull();
    expect(twosComplement(-300n, 8).steps).toBeNull(); // does not fit
  });

  it("works for 1-bit, 32-bit, 64-bit and 128-bit widths", () => {
    expect(twosComplement(-1n, 1)).toMatchObject({ unsigned: 1n, signed: -1n, binary: "1" });
    expect(twosComplement(-2147483648n, 32)).toMatchObject({ hex: "80000000", signed: -2147483648n });
    expect(twosComplement(-1n, 64).hex).toBe("FFFFFFFFFFFFFFFF");
    expect(twosComplement(2n ** 127n, 128)).toMatchObject({ signed: -(2n ** 127n) });
  });

  it("rejects bad widths", () => {
    expect(() => twosComplement(1n, 0)).toThrow(RangeError);
    expect(() => twosComplement(1n, 513)).toThrow(RangeError);
    expect(() => twosComplement(1n, 1.5)).toThrow(RangeError);
  });
});

describe("groupBinary", () => {
  it("groups from the right", () => {
    expect(groupBinary("11111111")).toBe("1111 1111");
    expect(groupBinary("10110")).toBe("1 0110");
    expect(groupBinary("")).toBe("");
    expect(groupBinary("1010101010101010", 8)).toBe("10101010 10101010");
  });
});

describe("parseHexBytes / conversions", () => {
  it("parses common notations", () => {
    expect(parseHexBytes("12 34 56 78")).toEqual({ ok: true, bytes: [0x12, 0x34, 0x56, 0x78] });
    expect(parseHexBytes("0x12345678")).toEqual({ ok: true, bytes: [0x12, 0x34, 0x56, 0x78] });
    expect(parseHexBytes("12:34:ab")).toEqual({ ok: true, bytes: [0x12, 0x34, 0xab] });
    expect(parseHexBytes("0x12, 0x34")).toEqual({ ok: true, bytes: [0x12, 0x34] });
    expect(parseHexBytes("DEADBEEF")).toEqual({ ok: true, bytes: [0xde, 0xad, 0xbe, 0xef] });
  });

  it("rejects bad input", () => {
    expect(parseHexBytes("")).toMatchObject({ ok: false });
    expect(parseHexBytes("zz")).toMatchObject({ ok: false, error: expect.stringContaining("not hex") });
    expect(parseHexBytes("123")).toMatchObject({ ok: false, error: expect.stringContaining("odd number") });
    expect(parseHexBytes("12 345")).toMatchObject({ ok: false, error: expect.stringContaining("one byte") });
    expect(parseHexBytes("00".repeat(65))).toMatchObject({ ok: false, error: expect.stringContaining("At most 64") });
  });

  it("converts between bytes and integers in both orders", () => {
    expect(bytesToHex([0xde, 0xad, 0x0b])).toBe("DE AD 0B");
    expect(bytesToHex([1, 2], "")).toBe("0102");
    expect(bytesToBigInt([0x12, 0x34], false)).toBe(0x1234n);
    expect(bytesToBigInt([0x12, 0x34], true)).toBe(0x3412n);
    expect(bigIntToBytes(0x12345678n, 4, false)).toEqual([0x12, 0x34, 0x56, 0x78]);
    expect(bigIntToBytes(0x12345678n, 4, true)).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(bigIntToBytes(0x1ffn, 1, false)).toEqual([0xff]);
    expect(bigIntToBytes(-1n, 2, false)).toEqual([0xff, 0xff]);
  });
});

describe("endianness", () => {
  it("swaps bytes and reads both ways", () => {
    const v = endianness([0x12, 0x34, 0x56, 0x78]);
    expect(v.swapped).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(v.asBigEndian).toBe(0x12345678n);
    expect(v.asLittleEndian).toBe(0x78563412n);
    expect(v.wordSwapped).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("swaps each 32-bit word of longer inputs", () => {
    const v = endianness([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(v.swapped).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(v.wordSwapped).toEqual([4, 3, 2, 1, 8, 7, 6, 5]);
    expect(endianness([1, 2]).wordSwapped).toBeNull();
    expect(endianness([0xab]).asLittleEndian).toBe(0xabn);
  });
});

describe("parseFlagDefinitions", () => {
  it("accepts several syntaxes, comments and blank lines", () => {
    const { flags, errors } = parseFlagDefinitions(
      "# permissions\nREAD = 1\nWRITE = 0x2,\nEXEC = 1 << 2 // run\nHIDDEN: 8\nSYSTEM 16\n\nbit 5 ARCHIVE\n6: DIR\n",
    );
    expect(errors).toEqual([]);
    expect(flags).toEqual([
      { name: "READ", mask: 1n },
      { name: "WRITE", mask: 2n },
      { name: "EXEC", mask: 4n },
      { name: "HIDDEN", mask: 8n },
      { name: "SYSTEM", mask: 16n },
      { name: "ARCHIVE", mask: 32n },
      { name: "DIR", mask: 64n },
    ]);
  });

  it("supports multi-bit masks", () => {
    expect(parseFlagDefinitions("MODE = 0b110").flags).toEqual([{ name: "MODE", mask: 6n }]);
  });

  it("reports bad lines with their number", () => {
    const { flags, errors } = parseFlagDefinitions("A = 1\nB = zero\nA = 2\n= 4\nC = 1 << 999\nD = 0");
    expect(flags).toEqual([{ name: "A", mask: 1n }]);
    expect(errors).toEqual([
      'Line 2: "zero" is not a positive number.',
      'Line 3: "A" is defined twice.',
      'Line 4: expected "NAME = value", got "= 4".',
      "Line 5: shift is too large.",
      'Line 6: "0" is not a positive number.',
    ]);
  });
});

describe("flags", () => {
  const { flags } = parseFlagDefinitions("READ=1\nWRITE=2\nEXEC=4\nMODE=0b11000");

  it("decodes set flags and unknown bits", () => {
    expect(decodeFlags(0b101n, flags)).toEqual({ set: ["READ", "EXEC"], unknown: 0n });
    expect(decodeFlags(0b100000n, flags)).toEqual({ set: [], unknown: 32n });
    // a multi-bit flag needs all of its bits
    expect(decodeFlags(0b01000n, flags).set).toEqual([]);
    expect(decodeFlags(0b11000n, flags).set).toEqual(["MODE"]);
  });

  it("encodes names back to a value", () => {
    expect(encodeFlags(["READ", "EXEC"], flags)).toBe(5n);
    expect(encodeFlags(["MODE"], flags, 1n)).toBe(0b11001n);
    expect(encodeFlags([], flags)).toBe(0n);
  });

  it("lists set bit indexes", () => {
    expect(setBits(0b10101n)).toEqual([0, 2, 4]);
    expect(setBits(0n)).toEqual([]);
    expect(setBits(2n ** 100n)).toEqual([100]);
  });
});

describe("applyBitOp", () => {
  it("applies operations inside the width", () => {
    expect(applyBitOp(0b1100n, "and", 0b1010n, 8)).toBe(0b1000n);
    expect(applyBitOp(0b1100n, "or", 0b1010n, 8)).toBe(0b1110n);
    expect(applyBitOp(0b1100n, "xor", 0b1010n, 8)).toBe(0b0110n);
    expect(applyBitOp(0b1100n, "not", 0n, 8)).toBe(0b11110011n);
    expect(applyBitOp(0b1000_0001n, "shl", 1n, 8)).toBe(0b0000_0010n);
    expect(applyBitOp(0b1000_0001n, "shr", 1n, 8)).toBe(0b0100_0000n);
    expect(applyBitOp(0n, "set", 3n, 8)).toBe(8n);
    expect(applyBitOp(0xffn, "clear", 0n, 8)).toBe(0xfen);
    expect(applyBitOp(0b101n, "toggle", 1n, 8)).toBe(0b111n);
    expect(applyBitOp(0b101n, "set", 20n, 8)).toBe(0b101n); // outside the width: ignored
  });
});
