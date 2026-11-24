/** Random identifiers: UUID v4 / v7 (RFC 9562), ULID, NanoID. Randomness and clock are injectable for tests. */

/** Returns `n` cryptographically secure random bytes. */
export type RandomBytes = (n: number) => Uint8Array;

export const secureRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export const MAX_COUNT = 1000;

// ---------------------------------------------------------------- UUID

export interface UuidFormat {
  uppercase: boolean;
  hyphens: boolean;
}

export function formatUuid(bytes: Uint8Array, format: UuidFormat = { uppercase: false, hyphens: true }): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const text = format.hyphens
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : hex;
  return format.uppercase ? text.toUpperCase() : text;
}

/** Stamp version (high nibble of byte 6) and RFC 4122 variant (10xx in byte 8). */
function setVersionAndVariant(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

export function uuidV4Bytes(random: RandomBytes = secureRandom): Uint8Array {
  return setVersionAndVariant(random(16).slice(), 4);
}

/**
 * UUID v7: 48-bit Unix ms timestamp, then 12 bits used as a counter, then random.
 * Within one generator, ids are strictly increasing even when created in the same millisecond
 * (RFC 9562 section 6.2, method 1: fixed-length dedicated counter in rand_a).
 */
export function createUuidV7Generator(random: RandomBytes = secureRandom, now: () => number = Date.now) {
  let lastMs = -1;
  let counter = 0;

  return function next(): Uint8Array {
    let ms = Math.floor(now());
    if (ms > lastMs) {
      const r = random(2);
      counter = ((r[0] << 8) | r[1]) & 0x7ff; // leave headroom so the counter does not overflow quickly
    } else {
      ms = lastMs; // clock did not advance (or went backwards): keep ordering
      counter++;
      if (counter > 0xfff) {
        ms++;
        counter = 0;
      }
    }
    lastMs = ms;

    const bytes = random(16).slice();
    const view = new DataView(bytes.buffer);
    view.setUint16(0, Math.floor(ms / 2 ** 32) & 0xffff);
    view.setUint32(2, ms >>> 0);
    bytes[6] = 0x70 | (counter >> 8);
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytes;
  };
}

/** Unix ms embedded in a UUID v7. */
export function uuidV7Timestamp(uuid: string): number | null {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex) || hex[12] !== "7") return null;
  return parseInt(hex.slice(0, 12), 16);
}

// ---------------------------------------------------------------- ULID

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_ULID_TIME = 2 ** 48 - 1;

function encodeBase32(value: bigint, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

/** Encode an explicit timestamp and 80-bit random value as a ULID. */
export function encodeUlid(timeMs: number, randomPart: bigint): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_ULID_TIME) throw new RangeError("ULID time must be 0..2^48-1");
  if (randomPart < 0n || randomPart >= 1n << 80n) throw new RangeError("ULID random part must fit in 80 bits");
  return encodeBase32(BigInt(timeMs), 10) + encodeBase32(randomPart, 16);
}

/** Unix ms from a ULID string, or null if it is not a valid ULID. */
export function decodeUlidTime(ulid: string): number | null {
  const text = ulid.toUpperCase();
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(text) || text[0] > "7") return null;
  let value = 0;
  for (const ch of text.slice(0, 10)) value = value * 32 + CROCKFORD.indexOf(ch);
  return value;
}

/** Monotonic ULID generator: within the same millisecond the random part is incremented. */
export function createUlidGenerator(random: RandomBytes = secureRandom, now: () => number = Date.now) {
  let lastMs = -1;
  let lastRandom = 0n;

  const randomBigInt = () => random(10).reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);

  return function next(): string {
    let ms = Math.floor(now());
    if (ms > lastMs) {
      lastRandom = randomBigInt();
    } else {
      ms = lastMs;
      lastRandom += 1n;
      if (lastRandom >= 1n << 80n) {
        ms++;
        lastRandom = randomBigInt();
      }
    }
    lastMs = ms;
    return encodeUlid(ms, lastRandom);
  };
}

// ---------------------------------------------------------------- NanoID

export const NANOID_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
export const DEFAULT_NANOID_SIZE = 21;

export function validateNanoidOptions(alphabet: string, size: number): string | null {
  const chars = Array.from(alphabet);
  if (chars.length < 2) return "The alphabet needs at least 2 characters";
  if (chars.length > 256) return "The alphabet can have at most 256 characters";
  if (new Set(chars).size !== chars.length) return "The alphabet contains duplicate characters";
  if (!Number.isInteger(size) || size < 1 || size > 256) return "Size must be a whole number from 1 to 256";
  return null;
}

/**
 * NanoID-style id. Uses rejection sampling, so every character is equally likely
 * (plain `byte % length` would favour the first characters for alphabets that are not a power of two).
 */
export function nanoid(random: RandomBytes = secureRandom, size = DEFAULT_NANOID_SIZE, alphabet = NANOID_ALPHABET): string {
  const error = validateNanoidOptions(alphabet, size);
  if (error) throw new RangeError(error);
  const chars = Array.from(alphabet);
  const mask = (2 << (31 - Math.clz32((chars.length - 1) | 1))) - 1;
  // Accepted bytes per request ≈ chars.length / (mask + 1); over-request to usually finish in one round.
  const step = Math.ceil((1.6 * (mask + 1) * size) / chars.length);

  const out: string[] = []; // counted in characters, not UTF-16 code units
  while (out.length < size) {
    for (const byte of random(step)) {
      const index = byte & mask;
      if (index < chars.length) {
        out.push(chars[index]);
        if (out.length === size) break;
      }
    }
  }
  return out.join("");
}

// ---------------------------------------------------------------- batch

export type IdKind = "uuid-v4" | "uuid-v7" | "ulid" | "nanoid";

export interface GenerateOptions {
  kind: IdKind;
  count: number;
  uppercase: boolean;
  hyphens: boolean;
  nanoidSize: number;
  nanoidAlphabet: string;
}

export const clampCount = (count: number) => (Number.isFinite(count) ? Math.min(MAX_COUNT, Math.max(1, Math.floor(count))) : 1);

export function generateIds(options: GenerateOptions, random: RandomBytes = secureRandom, now: () => number = Date.now): string[] {
  const count = clampCount(options.count);
  const format = { uppercase: options.uppercase, hyphens: options.hyphens };
  const out: string[] = [];

  switch (options.kind) {
    case "uuid-v4":
      for (let i = 0; i < count; i++) out.push(formatUuid(uuidV4Bytes(random), format));
      break;
    case "uuid-v7": {
      const next = createUuidV7Generator(random, now);
      for (let i = 0; i < count; i++) out.push(formatUuid(next(), format));
      break;
    }
    case "ulid": {
      const next = createUlidGenerator(random, now);
      for (let i = 0; i < count; i++) {
        const id = next();
        out.push(options.uppercase ? id : id.toLowerCase());
      }
      break;
    }
    case "nanoid":
      for (let i = 0; i < count; i++) out.push(nanoid(random, options.nanoidSize, options.nanoidAlphabet));
      break;
  }
  return out;
}
