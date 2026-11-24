import { describe, expect, it } from "vitest";
import { MAX_INPUT_LENGTH, formatInteger, groupDigits, isValidBase, parseInteger } from "./logic";

const parse = (text: string, base: number) => {
  const result = parseInteger(text, base);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const error = (text: string, base: number) => {
  const result = parseInteger(text, base);
  if (result.ok) throw new Error("expected an error");
  return result.error;
};

describe("isValidBase", () => {
  it("accepts 2..36 whole numbers only", () => {
    expect(isValidBase(2)).toBe(true);
    expect(isValidBase(36)).toBe(true);
    for (const bad of [1, 0, 37, -2, 2.5, NaN, Infinity]) expect(isValidBase(bad)).toBe(false);
  });
});

describe("parseInteger", () => {
  it("parses each common base", () => {
    expect(parse("1010", 2)).toBe(10n);
    expect(parse("777", 8)).toBe(511n);
    expect(parse("255", 10)).toBe(255n);
    expect(parse("ff", 16)).toBe(255n);
    expect(parse("zz", 36)).toBe(1295n);
  });

  it("is case-insensitive", () => {
    expect(parse("FF", 16)).toBe(255n);
    expect(parse("Zz", 36)).toBe(1295n);
  });

  it("handles signs, zero and leading zeros", () => {
    expect(parse("-ff", 16)).toBe(-255n);
    expect(parse("+10", 10)).toBe(10n);
    expect(parse("0", 10)).toBe(0n);
    expect(parse("-0", 10)).toBe(0n);
    expect(parse("0000012", 10)).toBe(12n);
  });

  it("strips the matching prefix only", () => {
    expect(parse("0xff", 16)).toBe(255n);
    expect(parse("-0XFF", 16)).toBe(-255n);
    expect(parse("0b101", 2)).toBe(5n);
    expect(parse("0o17", 8)).toBe(15n);
    // 0b is a valid hex number, not a prefix, in base 16
    expect(parse("0b1", 16)).toBe(0xb1n);
    // x is a digit in base 36
    expect(parse("0x1", 36)).toBe(BigInt(parseInt("0x1", 36)));
  });

  it("ignores separators and whitespace", () => {
    expect(parse("1111 0000", 2)).toBe(240n);
    expect(parse("1_000_000", 10)).toBe(1000000n);
    expect(parse("1,234", 10)).toBe(1234n);
    expect(parse("  ff\n", 16)).toBe(255n);
  });

  it("has no precision limit", () => {
    expect(parse("123456789012345678901234567890", 10)).toBe(123456789012345678901234567890n);
    expect(parse("f".repeat(64), 16)).toBe(2n ** 256n - 1n);
  });

  it("reports the offending digit", () => {
    expect(error("12", 2)).toBe('"2" is not a valid digit in base 2');
    expect(error("fg", 16)).toBe('"g" is not a valid digit in base 16');
    expect(error("1.5", 10)).toMatch(/only integers/);
    expect(error("0xff", 10)).toMatch(/"x" is not a valid digit/);
    expect(error("1-2", 10)).toMatch(/"-"/);
  });

  it("rejects empty input, lone signs and prefixes", () => {
    for (const text of ["", "  ", "-", "+", "0x", "-0b"]) {
      expect(error(text, text.includes("b") ? 2 : 16)).toBe("Enter a number");
    }
  });

  it("rejects invalid bases and oversized input", () => {
    expect(error("1", 1)).toMatch(/Base must be/);
    expect(error("1", 37)).toMatch(/Base must be/);
    expect(error("1", 2.5)).toMatch(/Base must be/);
    expect(error("1".repeat(MAX_INPUT_LENGTH + 1), 10)).toMatch(/too long/);
  });
});

describe("formatInteger", () => {
  it("formats in any base", () => {
    expect(formatInteger(255n, 2)).toBe("11111111");
    expect(formatInteger(255n, 16)).toBe("ff");
    expect(formatInteger(-255n, 8)).toBe("-377");
    expect(formatInteger(1295n, 36)).toBe("zz");
    expect(formatInteger(0n, 2)).toBe("0");
  });

  it("supports uppercase and grouping", () => {
    expect(formatInteger(255n, 16, { uppercase: true })).toBe("FF");
    expect(formatInteger(0xdeadbeefn, 16, { group: 4, separator: "_" })).toBe("dead_beef");
    expect(formatInteger(-1234567n, 10, { group: 3, separator: "," })).toBe("-1,234,567");
  });

  it("rejects invalid bases", () => {
    expect(() => formatInteger(1n, 1)).toThrow(RangeError);
    expect(() => formatInteger(1n, 37)).toThrow(RangeError);
  });

  it("round-trips through every base", () => {
    const value = 2n ** 130n + 12345n;
    for (let base = 2; base <= 36; base++) {
      expect(parse(formatInteger(value, base), base)).toBe(value);
      expect(parse(formatInteger(-value, base, { uppercase: true, group: 3 }), base)).toBe(-value);
    }
  });
});

describe("groupDigits", () => {
  it("groups from the right", () => {
    expect(groupDigits("1234567", 3, ",")).toBe("1,234,567");
    expect(groupDigits("101", 4, " ")).toBe("101");
    expect(groupDigits("12345678", 4, " ")).toBe("1234 5678");
    expect(groupDigits("123456789", 4, " ")).toBe("1 2345 6789");
  });

  it("ignores a non-positive size", () => {
    expect(groupDigits("1234", 0, ",")).toBe("1234");
    expect(groupDigits("1234", -1, ",")).toBe("1234");
  });
});
