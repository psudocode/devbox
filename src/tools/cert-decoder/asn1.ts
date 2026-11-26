/** A small, strict ASN.1 DER reader: just enough to decode X.509 certificates, CSRs and public keys. */

export class Asn1Error extends Error {}

export interface Asn1Node {
  /** 0 universal, 1 application, 2 context-specific, 3 private. */
  tagClass: 0 | 1 | 2 | 3;
  constructed: boolean;
  tag: number;
  headerLength: number;
  /** Content bytes (without the tag and length). */
  value: Uint8Array;
  /** The complete tag + length + content bytes. */
  raw: Uint8Array;
}

export const TAG = {
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  NULL: 5,
  OID: 6,
  UTF8_STRING: 12,
  SEQUENCE: 16,
  SET: 17,
  NUMERIC_STRING: 18,
  PRINTABLE_STRING: 19,
  T61_STRING: 20,
  IA5_STRING: 22,
  UTC_TIME: 23,
  GENERALIZED_TIME: 24,
  VISIBLE_STRING: 26,
  BMP_STRING: 30,
} as const;

const MAX_LENGTH_BYTES = 4;

/** Parse one TLV starting at `offset`. Throws `Asn1Error` for anything malformed (including indefinite lengths). */
export function parseTlv(bytes: Uint8Array, offset = 0): Asn1Node {
  let pos = offset;
  if (pos >= bytes.length) throw new Asn1Error("Unexpected end of data.");
  const id = bytes[pos++];
  let tag = id & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let count = 0;
    for (;;) {
      if (pos >= bytes.length) throw new Asn1Error("Truncated tag.");
      const b = bytes[pos++];
      tag = tag * 128 + (b & 0x7f);
      if (++count > 4) throw new Asn1Error("Tag number is too large.");
      if ((b & 0x80) === 0) break;
    }
  }
  if (pos >= bytes.length) throw new Asn1Error("Truncated length.");
  const first = bytes[pos++];
  let length = first;
  if (first & 0x80) {
    const n = first & 0x7f;
    if (n === 0) throw new Asn1Error("Indefinite lengths are not allowed in DER.");
    if (n > MAX_LENGTH_BYTES) throw new Asn1Error("Length is too large.");
    if (pos + n > bytes.length) throw new Asn1Error("Truncated length.");
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + bytes[pos++];
  }
  if (pos + length > bytes.length) throw new Asn1Error(`Truncated value: expected ${length} bytes but only ${bytes.length - pos} remain.`);
  return {
    tagClass: (id >> 6) as Asn1Node["tagClass"],
    constructed: (id & 0x20) !== 0,
    tag,
    headerLength: pos - offset,
    value: bytes.subarray(pos, pos + length),
    raw: bytes.subarray(offset, pos + length),
  };
}

/** Parse a buffer that must contain exactly one TLV. */
export function parseDer(bytes: Uint8Array): Asn1Node {
  const node = parseTlv(bytes, 0);
  if (node.raw.length !== bytes.length) throw new Asn1Error(`${bytes.length - node.raw.length} unexpected bytes after the DER structure.`);
  return node;
}

export function children(node: Asn1Node): Asn1Node[] {
  if (!node.constructed) throw new Asn1Error("Expected a constructed value.");
  const out: Asn1Node[] = [];
  let pos = 0;
  while (pos < node.value.length) {
    const child = parseTlv(node.value, pos);
    out.push(child);
    pos += child.raw.length;
  }
  return out;
}

export const isUniversal = (n: Asn1Node, tag: number): boolean => n.tagClass === 0 && n.tag === tag;
export const isContext = (n: Asn1Node, tag: number): boolean => n.tagClass === 2 && n.tag === tag;

export function expect(node: Asn1Node | undefined, tag: number, what: string): Asn1Node {
  if (!node || !isUniversal(node, tag)) throw new Asn1Error(`Expected ${what}.`);
  return node;
}

export function decodeOid(node: Asn1Node): string {
  if (!isUniversal(node, TAG.OID)) throw new Asn1Error("Expected an OBJECT IDENTIFIER.");
  const b = node.value;
  if (b.length === 0) throw new Asn1Error("Empty OBJECT IDENTIFIER.");
  const arcs: bigint[] = [];
  let acc = 0n;
  for (let i = 0; i < b.length; i++) {
    acc = (acc << 7n) | BigInt(b[i] & 0x7f);
    if ((b[i] & 0x80) === 0) {
      arcs.push(acc);
      acc = 0n;
    }
  }
  if (b[b.length - 1] & 0x80) throw new Asn1Error("Truncated OBJECT IDENTIFIER.");
  const head = arcs[0];
  const first = head < 40n ? 0n : head < 80n ? 1n : 2n;
  return [first, head - first * 40n, ...arcs.slice(1)].join(".");
}

/** Unsigned magnitude of an INTEGER (leading zero bytes removed). */
export function integerBytes(node: Asn1Node): Uint8Array {
  if (!isUniversal(node, TAG.INTEGER)) throw new Asn1Error("Expected an INTEGER.");
  let v = node.value;
  while (v.length > 1 && v[0] === 0) v = v.subarray(1);
  return v;
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

/** Bit length of an unsigned big-endian number. */
export function bitLength(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return 0;
  return (bytes.length - i) * 8 - Math.clz32(bytes[i]) + 24;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "ab:cd:ef" in the given case. */
export function toColonHex(bytes: Uint8Array, upper = true): string {
  const s = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(":");
  return upper ? s.toUpperCase() : s;
}

/** Content of a BIT STRING: the bytes and the number of unused trailing bits. */
export function bitString(node: Asn1Node): { bytes: Uint8Array; unused: number } {
  if (!isUniversal(node, TAG.BIT_STRING)) throw new Asn1Error("Expected a BIT STRING.");
  if (node.value.length === 0) throw new Asn1Error("Empty BIT STRING.");
  const unused = node.value[0];
  if (unused > 7) throw new Asn1Error("Invalid BIT STRING padding.");
  return { bytes: node.value.subarray(1), unused };
}

export function bitIsSet(bytes: Uint8Array, index: number): boolean {
  const byte = bytes[index >> 3];
  return byte !== undefined && (byte & (0x80 >> (index & 7))) !== 0;
}

export function decodeString(node: Asn1Node): string {
  switch (node.tag) {
    case TAG.UTF8_STRING:
      return new TextDecoder("utf-8").decode(node.value);
    case TAG.BMP_STRING: {
      let out = "";
      for (let i = 0; i + 1 < node.value.length; i += 2) out += String.fromCharCode((node.value[i] << 8) | node.value[i + 1]);
      return out;
    }
    case TAG.PRINTABLE_STRING:
    case TAG.IA5_STRING:
    case TAG.T61_STRING:
    case TAG.NUMERIC_STRING:
    case TAG.VISIBLE_STRING:
      return Array.from(node.value, (b) => String.fromCharCode(b)).join("");
    default:
      return toHex(node.value);
  }
}

/** UTCTime / GeneralizedTime to an ISO 8601 UTC string. Only the "Z" form allowed by RFC 5280 is accepted. */
export function decodeTime(node: Asn1Node): string {
  const text = Array.from(node.value, (b) => String.fromCharCode(b)).join("");
  let m: RegExpExecArray | null;
  let year: number;
  if (isUniversal(node, TAG.UTC_TIME)) {
    m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (!m) throw new Asn1Error(`Invalid UTCTime "${text}".`);
    const yy = Number(m[1]);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
  } else if (isUniversal(node, TAG.GENERALIZED_TIME)) {
    m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (!m) throw new Asn1Error(`Invalid GeneralizedTime "${text}".`);
    year = Number(m[1]);
    m = [m[0], "", m[2], m[3], m[4], m[5], m[6]] as unknown as RegExpExecArray;
  } else {
    throw new Asn1Error("Expected a UTCTime or GeneralizedTime.");
  }
  const [month, day, hour, minute, second] = [m[2], m[3], m[4], m[5], m[6]].map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Asn1Error(`Invalid date "${text}".`);
  }
  return d.toISOString();
}
