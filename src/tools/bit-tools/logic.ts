/** Bit and byte helpers on BigInt: two's complement, endianness and bit flags. */

export type IntResult = { ok: true; value: bigint } | { ok: false; error: string };

/** Parse an integer: decimal (with sign), 0x hex, 0b binary, 0o octal; underscores and spaces inside digits are allowed. */
export function parseInteger(text: string): IntResult {
  let s = text.trim().replace(/[_\s]/g, "");
  if (s === "") return { ok: false, error: "Enter a number." };
  let negative = false;
  if (s.startsWith("-") || s.startsWith("+")) {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  let value: bigint;
  try {
    if (/^0x[0-9a-f]+$/i.test(s)) value = BigInt(s);
    else if (/^0b[01]+$/i.test(s)) value = BigInt(s);
    else if (/^0o[0-7]+$/i.test(s)) value = BigInt(s);
    else if (/^\d+$/.test(s)) value = BigInt(s);
    else return { ok: false, error: `"${text.trim()}" is not an integer (use decimal, 0x…, 0b… or 0o…).` };
  } catch {
    return { ok: false, error: `"${text.trim()}" is not an integer.` };
  }
  return { ok: true, value: negative ? -value : value };
}

export const MAX_BITS = 512;

export interface TwosComplement {
  bits: number;
  /** The value read as unsigned (after wrapping into the width). */
  unsigned: bigint;
  /** The value read as signed. */
  signed: bigint;
  binary: string;
  hex: string;
  minSigned: bigint;
  maxSigned: bigint;
  maxUnsigned: bigint;
  /** False when the input does not fit the width either as signed or as unsigned, so it wrapped around. */
  fits: boolean;
  /** For negative inputs: how to get the bit pattern by hand. */
  steps: { absolute: string; inverted: string; plusOne: string } | null;
}

const mask = (bits: number) => (1n << BigInt(bits)) - 1n;

/** Interpret `value` in `bits`-wide two's complement. */
export function twosComplement(value: bigint, bits: number): TwosComplement {
  if (!Number.isInteger(bits) || bits < 1 || bits > MAX_BITS) throw new RangeError(`Width must be between 1 and ${MAX_BITS} bits.`);
  const m = mask(bits);
  const unsigned = value & m; // BigInt & on negatives uses infinite two's complement, which is what we want
  const signBit = 1n << BigInt(bits - 1);
  const signed = unsigned & signBit ? unsigned - (1n << BigInt(bits)) : unsigned;
  const minSigned = -signBit;
  const maxSigned = signBit - 1n;
  const fits = value >= minSigned && value <= m;
  const pad = (n: bigint) => n.toString(2).padStart(bits, "0");

  let steps: TwosComplement["steps"] = null;
  if (value < 0n && fits) {
    const abs = -value;
    steps = { absolute: pad(abs), inverted: pad(~abs & m), plusOne: pad(unsigned) };
  }
  return {
    bits,
    unsigned,
    signed,
    binary: pad(unsigned),
    hex: unsigned.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0"),
    minSigned,
    maxSigned,
    maxUnsigned: m,
    fits,
    steps,
  };
}

/** Group a binary string in nibbles from the right: 10110 -> 1 0110. */
export function groupBinary(binary: string, size = 4): string {
  const parts: string[] = [];
  for (let end = binary.length; end > 0; end -= size) parts.unshift(binary.slice(Math.max(0, end - size), end));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------------------------
// Endianness
// ---------------------------------------------------------------------------------------------

export type BytesResult = { ok: true; bytes: number[] } | { ok: false; error: string };

/** Bytes from hex text: "12 34 56 78", "0x12345678", "12:34:56:78" or "12345678" (an even number of digits). */
export function parseHexBytes(text: string): BytesResult {
  const s = text.trim();
  if (s === "") return { ok: false, error: "Enter some bytes." };
  const tokens = s.split(/[\s,:;-]+/).filter(Boolean);
  const bytes: number[] = [];
  for (const raw of tokens) {
    const token = raw.replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]+$/.test(token)) return { ok: false, error: `"${raw}" is not hex.` };
    if (tokens.length > 1 && token.length !== 2 && !(raw.toLowerCase().startsWith("0x") && token.length <= 2)) {
      return { ok: false, error: `"${raw}" should be one byte (two hex digits) when bytes are separated.` };
    }
    if (token.length % 2 !== 0) return { ok: false, error: `"${raw}" has an odd number of hex digits; write whole bytes (e.g. 0A, not A).` };
    for (let i = 0; i < token.length; i += 2) bytes.push(parseInt(token.slice(i, i + 2), 16));
  }
  if (bytes.length > MAX_BITS / 8) return { ok: false, error: `At most ${MAX_BITS / 8} bytes are supported.` };
  return { ok: true, bytes };
}

export function bytesToHex(bytes: number[], separator = " "): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(separator);
}

export function bytesToBigInt(bytes: number[], littleEndian: boolean): bigint {
  const ordered = littleEndian ? [...bytes].reverse() : bytes;
  return ordered.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
}

/** The `size` bytes of `value`, most significant first (big endian) or last (little endian). */
export function bigIntToBytes(value: bigint, size: number, littleEndian: boolean): number[] {
  const out: number[] = [];
  let v = value & mask(size * 8);
  for (let i = 0; i < size; i++) {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return littleEndian ? out.reverse() : out;
}

export interface EndianView {
  size: number;
  /** Bytes as written (the order the user typed them in). */
  input: number[];
  /** The same bytes in the opposite order. */
  swapped: number[];
  /** Value when the input order is read as big endian / little endian. */
  asBigEndian: bigint;
  asLittleEndian: bigint;
  /** 32-bit and 16-bit word swaps for 4- and 8-byte inputs (htonl / bswap32 style). */
  wordSwapped: number[] | null;
}

export function endianness(bytes: number[]): EndianView {
  const swapped = [...bytes].reverse();
  let wordSwapped: number[] | null = null;
  if (bytes.length >= 4 && bytes.length % 4 === 0) {
    wordSwapped = [];
    for (let i = 0; i < bytes.length; i += 4) wordSwapped.push(...bytes.slice(i, i + 4).reverse());
  }
  return {
    size: bytes.length,
    input: bytes,
    swapped,
    asBigEndian: bytesToBigInt(bytes, false),
    asLittleEndian: bytesToBigInt(bytes, true),
    wordSwapped,
  };
}

// ---------------------------------------------------------------------------------------------
// Bit flags
// ---------------------------------------------------------------------------------------------

export interface FlagDefinition {
  name: string;
  /** One or more bits. */
  mask: bigint;
}

export type FlagParse = { flags: FlagDefinition[]; errors: string[] };

/**
 * Flag definitions, one per line: `READ = 1`, `WRITE = 0x2`, `EXEC = 1 << 2`, `NAME: 4`, `NAME 8`.
 * `bit N NAME` and `N: NAME` (a bit index) are accepted too. Lines starting with # or // are ignored.
 */
export function parseFlagDefinitions(text: string): FlagParse {
  const flags: FlagDefinition[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s*(#|\/\/).*$/, "").trim().replace(/,$/, "");
    if (line === "") return;
    const where = `Line ${index + 1}`;

    const byIndex = /^(?:bit\s+)?(\d{1,3})\s*[:=]?\s*([A-Za-z_][\w.-]*)$/i.exec(line);
    const named = /^([A-Za-z_][\w.-]*)\s*(?:=|:)?\s*(.+)$/.exec(line);
    let name: string;
    let mask: bigint;

    if (byIndex && Number(byIndex[1]) < MAX_BITS) {
      name = byIndex[2];
      mask = 1n << BigInt(byIndex[1]);
    } else if (named) {
      name = named[1];
      const shift = /^1\s*<<\s*(\d{1,3})$/.exec(named[2].trim());
      if (shift) {
        if (Number(shift[1]) >= MAX_BITS) {
          errors.push(`${where}: shift is too large.`);
          return;
        }
        mask = 1n << BigInt(shift[1]);
      } else {
        const parsed = parseInteger(named[2]);
        if (!parsed.ok || parsed.value <= 0n) {
          errors.push(`${where}: "${named[2].trim()}" is not a positive number.`);
          return;
        }
        mask = parsed.value;
      }
    } else {
      errors.push(`${where}: expected "NAME = value", got "${line}".`);
      return;
    }
    if (seen.has(name)) {
      errors.push(`${where}: "${name}" is defined twice.`);
      return;
    }
    seen.add(name);
    flags.push({ name, mask });
  });
  return { flags, errors };
}

export interface FlagDecode {
  set: string[];
  /** Bits that are set but belong to no named flag. */
  unknown: bigint;
}

/** A flag is "set" when all of its bits are set. */
export function decodeFlags(value: bigint, flags: FlagDefinition[]): FlagDecode {
  const set: string[] = [];
  let known = 0n;
  for (const flag of flags) {
    known |= flag.mask;
    if ((value & flag.mask) === flag.mask) set.push(flag.name);
  }
  return { set, unknown: value & ~known };
}

/** Value with exactly the named flags (plus `extra` bits) set. */
export function encodeFlags(names: string[], flags: FlagDefinition[], extra = 0n): bigint {
  return flags.filter((f) => names.includes(f.name)).reduce((acc, f) => acc | f.mask, extra);
}

/** Indexes of the set bits, lowest first. */
export function setBits(value: bigint): number[] {
  const out: number[] = [];
  for (let i = 0, v = value < 0n ? -value : value; v > 0n; i++, v >>= 1n) if (v & 1n) out.push(i);
  return out;
}

export type BitOp = "and" | "or" | "xor" | "not" | "shl" | "shr" | "set" | "clear" | "toggle";

/** Apply an operation within a width, so NOT and shifts stay inside it. */
export function applyBitOp(value: bigint, op: BitOp, operand: bigint, bits: number): bigint {
  const m = mask(bits);
  const v = value & m;
  switch (op) {
    case "and":
      return v & operand & m;
    case "or":
      return (v | operand) & m;
    case "xor":
      return (v ^ operand) & m;
    case "not":
      return ~v & m;
    case "shl":
      return (v << operand) & m;
    case "shr":
      return v >> operand;
    case "set":
      return (v | (1n << operand)) & m;
    case "clear":
      return v & ~(1n << operand) & m;
    case "toggle":
      return (v ^ (1n << operand)) & m;
  }
}
