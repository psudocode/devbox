import { describe, expect, it } from "vitest";
import {
  DEFAULT_NANOID_SIZE,
  MAX_COUNT,
  NANOID_ALPHABET,
  clampCount,
  createUlidGenerator,
  createUuidV7Generator,
  decodeUlidTime,
  encodeUlid,
  formatUuid,
  generateIds,
  nanoid,
  secureRandom,
  uuidV4Bytes,
  uuidV7Timestamp,
  validateNanoidOptions,
  type GenerateOptions,
  type RandomBytes,
} from "./logic";

/** Deterministic random source: cycles through the given bytes. */
const fixed = (...values: number[]): RandomBytes => {
  let i = 0;
  return (n) => Uint8Array.from({ length: n }, () => values[i++ % values.length]);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([89ab])[0-9a-f]{3}-[0-9a-f]{12}$/;

describe("formatUuid", () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
  it("formats with options", () => {
    expect(formatUuid(bytes)).toBe("00112233-4455-6677-8899-aabbccddeeff");
    expect(formatUuid(bytes, { uppercase: true, hyphens: true })).toBe("00112233-4455-6677-8899-AABBCCDDEEFF");
    expect(formatUuid(bytes, { uppercase: false, hyphens: false })).toBe("00112233445566778899aabbccddeeff");
  });
});

describe("uuid v4", () => {
  it("sets version 4 and the RFC variant whatever the random input", () => {
    for (const filler of [0x00, 0xff, 0x55]) {
      const match = UUID.exec(formatUuid(uuidV4Bytes(fixed(filler))));
      expect(match?.[1]).toBe("4");
      expect(match?.[2]).toMatch(/[89ab]/);
    }
    expect(formatUuid(uuidV4Bytes(fixed(0)))).toBe("00000000-0000-4000-8000-000000000000");
    expect(formatUuid(uuidV4Bytes(fixed(0xff)))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("does not mutate the random source's buffer", () => {
    const source = new Uint8Array(16).fill(1);
    uuidV4Bytes(() => source);
    expect([...source]).toEqual(new Array(16).fill(1));
  });

  it("is unique and well-formed with the real RNG", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => formatUuid(uuidV4Bytes())));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});

describe("uuid v7", () => {
  const T = Date.UTC(2026, 10, 25, 1, 0, 0);

  it("embeds the timestamp, version 7 and variant", () => {
    const next = createUuidV7Generator(fixed(0xaa), () => T);
    const id = formatUuid(next());
    expect(id).toMatch(UUID);
    expect(id[14]).toBe("7");
    expect(uuidV7Timestamp(id)).toBe(T);
  });

  it("matches the layout of a known timestamp", () => {
    // 0x018F0000_0000 ms → first 12 hex digits
    const next = createUuidV7Generator(fixed(0), () => 0x018f00000000);
    expect(formatUuid(next()).startsWith("018f0000-0000-7")).toBe(true);
  });

  it("is strictly increasing within the same millisecond", () => {
    const next = createUuidV7Generator(fixed(1, 2, 3, 4, 5), () => T);
    const ids = Array.from({ length: 500 }, () => formatUuid(next()));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(500);
  });

  it("stays ordered when the clock goes backwards", () => {
    const times = [T + 10, T + 5, T + 5, T + 11];
    let i = 0;
    const next = createUuidV7Generator(fixed(9), () => times[i++]);
    const ids = times.map(() => formatUuid(next()));
    expect([...ids].sort()).toEqual(ids);
    expect(uuidV7Timestamp(ids[1])).toBe(T + 10); // kept at the last timestamp, not the earlier clock
  });

  it("rolls into the next millisecond when the counter overflows", () => {
    const next = createUuidV7Generator(fixed(0), () => T);
    const ids = Array.from({ length: 5000 }, () => formatUuid(next()));
    expect([...ids].sort()).toEqual(ids);
    expect(uuidV7Timestamp(ids[4999])!).toBeGreaterThan(T);
  });

  it("uuidV7Timestamp rejects other versions and junk", () => {
    expect(uuidV7Timestamp(formatUuid(uuidV4Bytes()))).toBeNull();
    expect(uuidV7Timestamp("nope")).toBeNull();
  });

  it("works with the real clock and RNG", () => {
    const before = Date.now();
    const id = formatUuid(createUuidV7Generator()());
    const ts = uuidV7Timestamp(id)!;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1);
  });
});

describe("ulid", () => {
  it("encodes boundary values", () => {
    expect(encodeUlid(0, 0n)).toBe("00000000000000000000000000");
    expect(encodeUlid(2 ** 48 - 1, (1n << 80n) - 1n)).toBe("7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(encodeUlid(1, 1n)).toBe("00000000010000000000000001");
  });

  it("decodes the timestamp of the spec example", () => {
    expect(decodeUlidTime("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(1469922850259);
    expect(decodeUlidTime("01arz3ndektsv4rrffq69g5fav")).toBe(1469922850259);
  });

  it("round-trips timestamps", () => {
    for (const t of [0, 1, 1469922850259, Date.now(), 2 ** 48 - 1]) {
      expect(decodeUlidTime(encodeUlid(t, 123456789n))).toBe(t);
    }
  });

  it("rejects invalid input", () => {
    expect(() => encodeUlid(-1, 0n)).toThrow(RangeError);
    expect(() => encodeUlid(2 ** 48, 0n)).toThrow(RangeError);
    expect(() => encodeUlid(1.5, 0n)).toThrow(RangeError);
    expect(() => encodeUlid(0, 1n << 80n)).toThrow(RangeError);
    expect(decodeUlidTime("8ZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBeNull(); // overflow
    expect(decodeUlidTime("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBeNull(); // I is not Crockford
    expect(decodeUlidTime("short")).toBeNull();
  });

  it("generator is monotonic within a millisecond and sortable", () => {
    const next = createUlidGenerator(fixed(7, 1, 200), () => 1700000000000);
    const ids = Array.from({ length: 300 }, () => next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(300);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(decodeUlidTime(id)).toBe(1700000000000);
    }
  });

  it("generator rolls to the next ms when the 80-bit random part overflows", () => {
    const next = createUlidGenerator(fixed(0xff), () => 5);
    const first = next();
    const second = next();
    expect(decodeUlidTime(first)).toBe(5);
    expect(decodeUlidTime(second)).toBe(6);
  });
});

describe("nanoid", () => {
  it("has the requested length and only alphabet characters", () => {
    const id = nanoid();
    expect(id).toHaveLength(DEFAULT_NANOID_SIZE);
    for (const ch of id) expect(NANOID_ALPHABET).toContain(ch);
    expect(nanoid(secureRandom, 5, "ab")).toMatch(/^[ab]{5}$/);
    expect(nanoid(secureRandom, 256)).toHaveLength(256);
  });

  it("rejects out-of-range bytes instead of biasing the result", () => {
    // alphabet of 3 -> mask 3; byte 3 (and 7, 255...) must be skipped, not mapped via modulo
    expect(nanoid(fixed(3, 0, 1, 2, 255, 0), 3, "abc")).toBe("abc");
  });

  it("is uniform for a non-power-of-two alphabet", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (const ch of Array.from({ length: 300 }, () => nanoid(secureRandom, 256, "abc")).join("")) {
      counts[ch]++;
    }
    const total = counts.a + counts.b + counts.c;
    for (const n of Object.values(counts)) expect(Math.abs(n / total - 1 / 3)).toBeLessThan(0.02);
  });

  it("supports multi-code-unit characters in custom alphabets", () => {
    expect(nanoid(fixed(0, 1), 4, "🐙🦑")).toBe("🐙🦑🐙🦑");
  });

  it("validates options", () => {
    expect(validateNanoidOptions("ab", 10)).toBeNull();
    expect(validateNanoidOptions("a", 10)).toMatch(/at least 2/);
    expect(validateNanoidOptions("aab", 10)).toMatch(/duplicate/);
    expect(validateNanoidOptions("ab", 0)).toMatch(/Size/);
    expect(validateNanoidOptions("ab", 257)).toMatch(/Size/);
    expect(validateNanoidOptions("ab", 1.5)).toMatch(/Size/);
    expect(validateNanoidOptions(Array.from({ length: 257 }, (_, i) => String.fromCharCode(0x100 + i)).join(""), 5)).toMatch(/at most 256/);
    expect(() => nanoid(secureRandom, 0)).toThrow(RangeError);
  });
});

describe("generateIds", () => {
  const base: GenerateOptions = { kind: "uuid-v4", count: 3, uppercase: false, hyphens: true, nanoidSize: 21, nanoidAlphabet: NANOID_ALPHABET };

  it("generates the requested number of each kind", () => {
    expect(generateIds(base)).toHaveLength(3);
    expect(generateIds({ ...base, kind: "uuid-v7" })[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(generateIds({ ...base, kind: "ulid" })[0]).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    expect(generateIds({ ...base, kind: "ulid", uppercase: true })[0]).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(generateIds({ ...base, kind: "nanoid", nanoidSize: 8 })[0]).toHaveLength(8);
  });

  it("applies UUID formatting options", () => {
    expect(generateIds({ ...base, uppercase: true, hyphens: false })[0]).toMatch(/^[0-9A-F]{32}$/);
  });

  it("clamps the count", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(-5)).toBe(1);
    expect(clampCount(NaN)).toBe(1);
    expect(clampCount(2.9)).toBe(2);
    expect(clampCount(1e9)).toBe(MAX_COUNT);
    expect(generateIds({ ...base, count: 1e9 })).toHaveLength(MAX_COUNT);
  });

  it("generates sorted batches for time-ordered kinds", () => {
    for (const kind of ["uuid-v7", "ulid"] as const) {
      const ids = generateIds({ ...base, kind, count: 1000 });
      expect([...ids].sort()).toEqual(ids);
    }
  });
});
