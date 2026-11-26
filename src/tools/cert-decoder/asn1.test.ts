import { describe, expect, it } from "vitest";
import {
  Asn1Error,
  TAG,
  bitIsSet,
  bitLength,
  bitString,
  bytesToBigInt,
  children,
  decodeOid,
  decodeString,
  decodeTime,
  integerBytes,
  parseDer,
  parseTlv,
  toColonHex,
  toHex,
} from "./asn1";

const b = (...v: number[]) => Uint8Array.from(v);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const tlv = (tag: number, value: Uint8Array) => Uint8Array.from([tag, value.length, ...value]);

describe("parseTlv", () => {
  it("reads short and long form lengths", () => {
    const short = parseTlv(b(0x04, 0x02, 0xaa, 0xbb));
    expect(short.tag).toBe(TAG.OCTET_STRING);
    expect(toHex(short.value)).toBe("aabb");
    expect(short.headerLength).toBe(2);

    const payload = new Uint8Array(300).fill(7);
    const long = parseTlv(Uint8Array.from([0x04, 0x82, 0x01, 0x2c, ...payload]));
    expect(long.value).toHaveLength(300);
    expect(long.headerLength).toBe(4);
  });

  it("reads class and constructed bits", () => {
    const n = parseTlv(b(0xa0, 0x03, 0x02, 0x01, 0x02));
    expect(n.tagClass).toBe(2);
    expect(n.constructed).toBe(true);
    expect(n.tag).toBe(0);
  });

  it("reads high tag numbers", () => {
    expect(parseTlv(b(0x1f, 0x81, 0x00, 0x00)).tag).toBe(128);
  });

  it("rejects indefinite, truncated and oversized input", () => {
    expect(() => parseTlv(b(0x30, 0x80, 0x00, 0x00))).toThrow(/Indefinite/);
    expect(() => parseTlv(b(0x04, 0x05, 0x01))).toThrow(/Truncated value/);
    expect(() => parseTlv(b(0x04))).toThrow(Asn1Error);
    expect(() => parseTlv(b())).toThrow(/end of data/);
    expect(() => parseTlv(b(0x04, 0x85, 1, 2, 3, 4, 5))).toThrow(/too large/);
  });

  it("parseDer rejects trailing bytes", () => {
    expect(() => parseDer(b(0x05, 0x00, 0x00))).toThrow(/unexpected bytes/);
  });
});

describe("children", () => {
  it("walks a SEQUENCE", () => {
    const seq = parseDer(tlv(0x30, Uint8Array.from([...tlv(0x02, b(1)), ...tlv(0x02, b(2))])));
    const kids = children(seq);
    expect(kids.map((k) => k.value[0])).toEqual([1, 2]);
  });

  it("refuses primitives", () => {
    expect(() => children(parseDer(tlv(0x04, b(1))))).toThrow(/constructed/);
  });
});

describe("decodeOid", () => {
  it("decodes common OIDs", () => {
    expect(decodeOid(parseDer(b(0x06, 0x03, 0x55, 0x04, 0x03)))).toBe("2.5.4.3");
    expect(decodeOid(parseDer(b(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b)))).toBe("1.2.840.113549.1.1.11");
    expect(decodeOid(parseDer(b(0x06, 0x03, 0x2b, 0x65, 0x70)))).toBe("1.3.101.112");
  });

  it("handles arcs under 2 with a big first subidentifier", () => {
    // 2.999.3 -> first subidentifier 1079 = 0x88 0x37
    expect(decodeOid(parseDer(b(0x06, 0x03, 0x88, 0x37, 0x03)))).toBe("2.999.3");
  });

  it("decodes arcs beyond 2^53 exactly", () => {
    // 2.25.<128-bit UUID arcs> style value: 2.25.4294967296 ... use 2^40 = 0x20 80 80 80 80 00? build explicitly.
    const arc = 2n ** 60n;
    const bytes: number[] = [];
    let v = arc;
    bytes.unshift(Number(v & 0x7fn));
    v >>= 7n;
    while (v > 0n) {
      bytes.unshift(Number(v & 0x7fn) | 0x80);
      v >>= 7n;
    }
    expect(decodeOid(parseDer(Uint8Array.from([0x06, bytes.length + 1, 0x69, ...bytes])))).toBe(`2.25.${arc}`);
  });

  it("rejects truncated OIDs", () => {
    expect(() => decodeOid(parseDer(b(0x06, 0x02, 0x2b, 0x81)))).toThrow(/Truncated/);
  });
});

describe("integers and bits", () => {
  it("strips the sign byte and measures bit length", () => {
    const n = parseDer(b(0x02, 0x03, 0x00, 0x80, 0x01));
    expect(toHex(integerBytes(n))).toBe("8001");
    expect(bitLength(integerBytes(n))).toBe(16);
    expect(bitLength(b(0x01))).toBe(1);
    expect(bitLength(b(0x00, 0x00))).toBe(0);
    expect(bitLength(b(0x00, 0xff, 0xff))).toBe(16);
    expect(bytesToBigInt(b(0x01, 0x00, 0x01))).toBe(65537n);
  });

  it("reads BIT STRING flags", () => {
    const { bytes, unused } = bitString(parseDer(b(0x03, 0x03, 0x05, 0xa0, 0x20)));
    expect(unused).toBe(5);
    expect(bitIsSet(bytes, 0)).toBe(true);
    expect(bitIsSet(bytes, 1)).toBe(false);
    expect(bitIsSet(bytes, 2)).toBe(true);
    expect(bitIsSet(bytes, 10)).toBe(true);
    expect(bitIsSet(bytes, 99)).toBe(false);
  });

  it("formats colon hex", () => {
    expect(toColonHex(b(0xab, 0x01))).toBe("AB:01");
    expect(toColonHex(b(0xab, 0x01), false)).toBe("ab:01");
  });
});

describe("strings and time", () => {
  it("decodes the string types", () => {
    expect(decodeString(parseDer(tlv(TAG.UTF8_STRING, new TextEncoder().encode("Jakarta é")))))
      .toBe("Jakarta é");
    expect(decodeString(parseDer(tlv(TAG.PRINTABLE_STRING, ascii("ID"))))).toBe("ID");
    expect(decodeString(parseDer(tlv(TAG.IA5_STRING, ascii("a@b.c"))))).toBe("a@b.c");
    expect(decodeString(parseDer(tlv(TAG.BMP_STRING, b(0x00, 0x41, 0x00, 0x42))))).toBe("AB");
  });

  it("decodes UTCTime with the RFC 5280 century rule", () => {
    expect(decodeTime(parseDer(tlv(TAG.UTC_TIME, ascii("491231235959Z"))))).toBe("2049-12-31T23:59:59.000Z");
    expect(decodeTime(parseDer(tlv(TAG.UTC_TIME, ascii("500101000000Z"))))).toBe("1950-01-01T00:00:00.000Z");
  });

  it("decodes GeneralizedTime", () => {
    expect(decodeTime(parseDer(tlv(TAG.GENERALIZED_TIME, ascii("20501231235959Z"))))).toBe("2050-12-31T23:59:59.000Z");
  });

  it("rejects bad times", () => {
    expect(() => decodeTime(parseDer(tlv(TAG.UTC_TIME, ascii("2611261200Z"))))).toThrow(/Invalid UTCTime/);
    expect(() => decodeTime(parseDer(tlv(TAG.GENERALIZED_TIME, ascii("20261340000000Z"))))).toThrow(/Invalid date/);
    expect(() => decodeTime(parseDer(tlv(TAG.OCTET_STRING, ascii("x"))))).toThrow(/Expected a UTCTime/);
  });
});
