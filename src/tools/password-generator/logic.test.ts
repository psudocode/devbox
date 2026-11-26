import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS,
  DEFAULT_OPTIONS,
  DIGITS,
  LOWER,
  SYMBOLS,
  UPPER,
  activeSets,
  clampCount,
  clampLength,
  estimateStrength,
  generatePassword,
  generatePasswords,
  generatedEntropyBits,
  randomInt,
  secureRandom,
  validateOptions,
  type PasswordOptions,
  type RandomBytes,
} from "./logic";

/** Deterministic random source: cycles through the given bytes. */
const fixed = (...values: number[]): RandomBytes => {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => values[i++ % values.length]);
};

const opts = (patch: Partial<PasswordOptions> = {}): PasswordOptions => ({ ...DEFAULT_OPTIONS, ...patch });

describe("randomInt", () => {
  it("returns values in range", () => {
    for (let i = 0; i < 200; i++) {
      const v = randomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("is 0 for max 1 without reading randomness", () => {
    expect(randomInt(1, () => { throw new Error("should not be called"); })).toBe(0);
  });

  it("rejects values in the biased tail and retries", () => {
    // max 3 -> limit = floor(2^32 / 3) * 3 = 4294967295. 0xFFFFFFFF is rejected, next draw 0x00000004 -> 4 % 3 = 1.
    const bytes = [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x04];
    expect(randomInt(3, fixed(...bytes))).toBe(1);
  });

  it("rejects invalid max", () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(1.5)).toThrow(RangeError);
  });
});

describe("generatePassword", () => {
  it("has the requested length and only uses enabled sets", () => {
    const pw = generatePassword(opts({ length: 40, upper: false, symbols: false }));
    expect(pw).toHaveLength(40);
    expect(pw).toMatch(/^[a-z0-9]+$/);
  });

  it("includes every enabled set when requireEach is on", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(opts({ length: 4 }));
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
      expect([...pw].some((c) => SYMBOLS.includes(c))).toBe(true);
    }
  });

  it("excludes ambiguous characters when asked", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(opts({ length: 64, excludeAmbiguous: true }));
      expect([...pw].some((c) => AMBIGUOUS.includes(c))).toBe(false);
    }
  });

  it("is deterministic for a fixed random source", () => {
    const a = generatePassword(opts({ requireEach: false, upper: false, digits: false, symbols: false, length: 6 }), fixed(0, 0, 0, 1));
    expect(a).toBe("bbbbbb");
  });

  it("throws on invalid options", () => {
    expect(() => generatePassword(opts({ lower: false, upper: false, digits: false, symbols: false }))).toThrow(RangeError);
  });

  it("generates the requested number of passwords, clamped", () => {
    expect(generatePasswords(opts(), 5)).toHaveLength(5);
    expect(generatePasswords(opts(), 0)).toHaveLength(1);
    expect(generatePasswords(opts(), 10_000)).toHaveLength(100);
  });

  it("produces different passwords", () => {
    const set = new Set(generatePasswords(opts({ length: 24 }), 20));
    expect(set.size).toBe(20);
  });
});

describe("options", () => {
  it("validates", () => {
    expect(validateOptions(opts())).toBeNull();
    expect(validateOptions(opts({ lower: false, upper: false, digits: false, symbols: false }))).toMatch(/at least one/);
    expect(validateOptions(opts({ length: 2 }))).toMatch(/between/);
    expect(validateOptions(opts({ length: 300 }))).toMatch(/between/);
  });

  it("clamps length and count", () => {
    expect(clampLength(1)).toBe(4);
    expect(clampLength(9999)).toBe(256);
    expect(clampLength(NaN)).toBe(DEFAULT_OPTIONS.length);
    expect(clampCount(NaN)).toBe(1);
  });

  it("strips ambiguous characters from the active sets", () => {
    const sets = activeSets(opts({ excludeAmbiguous: true }));
    expect(sets.join("")).not.toMatch(/[O0oIl1|]/);
    expect(activeSets(opts({ symbols: false }))).toEqual([LOWER, UPPER, DIGITS]);
  });

  it("computes entropy from pool size", () => {
    expect(generatedEntropyBits(opts({ length: 10, upper: false, symbols: false, digits: true }))).toBeCloseTo(10 * Math.log2(36), 6);
  });
});

describe("estimateStrength", () => {
  it("handles the empty string", () => {
    const s = estimateStrength("");
    expect(s.bits).toBe(0);
    expect(s.label).toBe("Very weak");
  });

  it("flags common passwords, including leet-speak variants", () => {
    expect(estimateStrength("password").score).toBe(0);
    expect(estimateStrength("P@ssw0rd").warnings.join(" ")).toMatch(/common/);
    expect(estimateStrength("Password123!").warnings.join(" ")).toMatch(/common/);
  });

  it("penalizes repeats and sequences", () => {
    const repeated = estimateStrength("aaaaaaaaaaaa");
    const random = estimateStrength("kqzvmpxwhtly");
    expect(repeated.bits).toBeLessThan(random.bits);
    expect(estimateStrength("abcdefghijkl").bits).toBeLessThan(random.bits);
    expect(estimateStrength("qwertyuiop").warnings.join(" ")).toMatch(/sequences/);
  });

  it("rates a long random password as very strong", () => {
    const pw = generatePassword(opts({ length: 24 }));
    const s = estimateStrength(pw);
    expect(s.score).toBeGreaterThanOrEqual(3);
    expect(s.classes).toEqual(["lower", "upper", "digits", "symbols"]);
  });

  it("warns about short and single-type passwords", () => {
    const s = estimateStrength("12345");
    expect(s.warnings.join(" ")).toMatch(/Shorter than 8/);
    expect(s.warnings.join(" ")).toMatch(/Digits only/);
    expect(estimateStrength("zzzzzzzzzzzz").warnings.join(" ")).toMatch(/single character type/);
  });

  it("counts characters by code point, not UTF-16 units", () => {
    expect(estimateStrength("🔑🔑🔑").length).toBe(3);
  });

  it("gives crack times that grow with strength", () => {
    expect(estimateStrength("abc").crackTime.offline).toBe("instantly");
    expect(estimateStrength(generatePassword(opts({ length: 40 }))).crackTime.offline).toMatch(/years|universe/);
  });
});

describe("secureRandom", () => {
  it("returns the requested number of bytes", () => {
    expect(secureRandom(16)).toHaveLength(16);
  });
});
