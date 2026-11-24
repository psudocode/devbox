import { bytesToBase64 } from "../../lib/base64";
import { md5 } from "./md5";

export const ALGORITHMS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

/** HMAC block size in bytes (RFC 2104): 64 for MD5/SHA-1/SHA-256, 128 for SHA-384/SHA-512. */
const BLOCK_SIZE: Record<Algorithm, number> = { MD5: 64, "SHA-1": 64, "SHA-256": 64, "SHA-384": 128, "SHA-512": 128 };

export const utf8 = (text: string) => new TextEncoder().encode(text);

export async function digest(algorithm: Algorithm, data: Uint8Array): Promise<Uint8Array> {
  if (algorithm === "MD5") return md5(data);
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource));
}

/**
 * HMAC (RFC 2104) built on `digest`, for every algorithm including MD5.
 * Done by hand instead of crypto.subtle.sign because Web Crypto rejects empty keys and has no MD5.
 */
export async function hmac(algorithm: Algorithm, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const block = BLOCK_SIZE[algorithm];
  let k = key.length > block ? await digest(algorithm, key) : key;
  const padded = new Uint8Array(block);
  padded.set(k);
  k = padded;

  const inner = new Uint8Array(block + data.length);
  const outerPad = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    inner[i] = k[i] ^ 0x36;
    outerPad[i] = k[i] ^ 0x5c;
  }
  inner.set(data, block);
  const innerHash = await digest(algorithm, inner);

  const outer = new Uint8Array(block + innerHash.length);
  outer.set(outerPad);
  outer.set(innerHash, block);
  return digest(algorithm, outer);
}

export function toHex(bytes: Uint8Array, uppercase = false): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return uppercase ? hex.toUpperCase() : hex;
}

export type OutputFormat = "hex" | "HEX" | "base64";

export const formatDigest = (bytes: Uint8Array, format: OutputFormat): string =>
  format === "base64" ? bytesToBase64(bytes) : toHex(bytes, format === "HEX");

export interface HashRow {
  algorithm: Algorithm;
  value: string;
}

/** Hash (or HMAC when `hmacKey` is given) with every algorithm. */
export async function hashAll(data: Uint8Array, format: OutputFormat, hmacKey?: Uint8Array): Promise<HashRow[]> {
  return Promise.all(
    ALGORITHMS.map(async (algorithm) => {
      const bytes = hmacKey ? await hmac(algorithm, hmacKey, data) : await digest(algorithm, data);
      return { algorithm, value: formatDigest(bytes, format) };
    }),
  );
}

/** Normalize a pasted hash for comparison: drops whitespace/colons and lowercases hex. Base64 stays case-sensitive. */
export function normalizeForCompare(value: string): string {
  const compact = value.replace(/[\s:]/g, "");
  return /^[0-9a-fA-F]+$/.test(compact) ? compact.toLowerCase() : compact;
}

/** The algorithm whose output equals `expected` (hex in any case, or Base64), if any. */
export function findMatch(rows: readonly HashRow[], expected: string): Algorithm | null {
  const wanted = normalizeForCompare(expected);
  if (wanted === "") return null;
  for (const row of rows) {
    if (normalizeForCompare(row.value) === wanted) return row.algorithm;
  }
  return null;
}
