import { base64ToBytes, bytesToBase64 } from "../../lib/base64";

/** AES with WebCrypto: raw key / IV, password-based (self-describing container), and OpenSSL `enc -pbkdf2` compatible. */

export type Mode = "gcm" | "cbc" | "ctr";
export type KeyBits = 128 | 192 | 256;

export type BytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

const encoder = new TextEncoder();

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser does not provide WebCrypto (crypto.subtle). It needs a secure context (https or localhost).");
  return globalThis.crypto.subtle;
};

const MODE_NAME: Record<Mode, string> = { gcm: "AES-GCM", cbc: "AES-CBC", ctr: "AES-CTR" };
const MODE_ID: Record<Mode, number> = { gcm: 1, cbc: 2, ctr: 3 };
const ID_MODE: Record<number, Mode> = { 1: "gcm", 2: "cbc", 3: "ctr" };

export const IV_LENGTH: Record<Mode, number> = { gcm: 12, cbc: 16, ctr: 16 };
export const DEFAULT_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 5_000_000;

export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

class CryptoFailure extends Error {}

const fail = (message: string): never => {
  throw new CryptoFailure(message);
};

async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (err instanceof CryptoFailure) return { ok: false, error: err.message };
    if (err instanceof DOMException || (err instanceof Error && err.name === "OperationError")) {
      return { ok: false, error: "Decryption failed: the key, password or data is wrong, or the data was changed." };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function algorithm(mode: Mode, iv: Uint8Array, aad?: Uint8Array): AesGcmParams | AesCbcParams | AesCtrParams {
  if (mode === "gcm") return { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128, ...(aad ? { additionalData: aad as BufferSource } : {}) };
  if (mode === "cbc") return { name: "AES-CBC", iv: iv as BufferSource };
  return { name: "AES-CTR", counter: iv as BufferSource, length: 64 };
}

function checkKeyIv(mode: Mode, key: Uint8Array, iv: Uint8Array) {
  if (![16, 24, 32].includes(key.length)) fail(`An AES key is 16, 24 or 32 bytes (128, 192 or 256 bits); this one is ${key.length} bytes.`);
  if (mode === "gcm" ? iv.length < 1 : iv.length !== 16) {
    fail(mode === "gcm" ? "The IV must not be empty (12 bytes is standard)." : `${MODE_NAME[mode]} needs a 16-byte IV; this one is ${iv.length} bytes.`);
  }
}

async function importAesKey(mode: Mode, key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return subtle().importKey("raw", key as BufferSource, { name: MODE_NAME[mode] }, false, [usage]);
}

/** Encrypt with an explicit key and IV. For GCM the 16-byte tag is appended to the ciphertext. */
export function encryptRaw(input: { mode: Mode; key: Uint8Array; iv: Uint8Array; plaintext: Uint8Array; aad?: Uint8Array }): Promise<BytesResult> {
  return run(async () => {
    checkKeyIv(input.mode, input.key, input.iv);
    const key = await importAesKey(input.mode, input.key, "encrypt");
    return new Uint8Array(await subtle().encrypt(algorithm(input.mode, input.iv, input.aad), key, input.plaintext as BufferSource));
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

export function decryptRaw(input: { mode: Mode; key: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array; aad?: Uint8Array }): Promise<BytesResult> {
  return run(async () => {
    checkKeyIv(input.mode, input.key, input.iv);
    if (input.mode === "gcm" && input.ciphertext.length < 16) fail("AES-GCM data must include a 16-byte authentication tag; this is too short.");
    if (input.mode === "cbc" && (input.ciphertext.length === 0 || input.ciphertext.length % 16 !== 0)) {
      fail(`AES-CBC data is a multiple of 16 bytes; this is ${input.ciphertext.length}.`);
    }
    const key = await importAesKey(input.mode, input.key, "decrypt");
    return new Uint8Array(await subtle().decrypt(algorithm(input.mode, input.iv, input.aad), key, input.ciphertext as BufferSource));
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

// ---------------------------------------------------------------------------------------------
// Password-based
// ---------------------------------------------------------------------------------------------

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, bits: number, hash = "SHA-256"): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) fail(`Iterations must be a whole number from 1 to ${MAX_ITERATIONS.toLocaleString("en-US")}.`);
  const base = await subtle().importKey("raw", encoder.encode(password) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash }, base, bits));
}

const MAGIC = encoder.encode("DVB1");

/**
 * Container: "DVB1" | mode(1) | key bytes(1) | iterations(4, big endian) | salt length(1) | salt | iv length(1) | iv | ciphertext.
 * For AES-GCM the whole header is authenticated, so changing the iteration count or salt makes decryption fail.
 */
export interface PasswordOptions {
  mode: Mode;
  keyBits: KeyBits;
  iterations: number;
}

export function encryptWithPassword(password: string, plaintext: Uint8Array, options: PasswordOptions): Promise<BytesResult> {
  return run(async () => {
    if (password === "") fail("Enter a password.");
    const salt = randomBytes(16);
    const iv = randomBytes(IV_LENGTH[options.mode]);
    const key = await pbkdf2(password, salt, options.iterations, options.keyBits);
    const header = new Uint8Array([...MAGIC, MODE_ID[options.mode], options.keyBits / 8, ...u32(options.iterations), salt.length, ...salt, iv.length, ...iv]);
    const encrypted = await encryptRaw({ mode: options.mode, key, iv, plaintext, aad: options.mode === "gcm" ? header : undefined });
    if (!encrypted.ok) return fail(encrypted.error);
    return concat(header, encrypted.bytes);
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

export function decryptWithPassword(password: string, data: Uint8Array): Promise<BytesResult> {
  return run(async () => {
    if (password === "") fail("Enter the password.");
    if (data.length < 4 || !MAGIC.every((b, i) => data[i] === b)) fail('This does not look like data made by this tool (it should start with "DVB1" once decoded). For OpenSSL data use the OpenSSL format.');
    const mode = ID_MODE[data[4]];
    const keyBytes = data[5];
    if (!mode || ![16, 24, 32].includes(keyBytes)) fail("The header is damaged: unknown mode or key size.");
    const iterations = readU32(data, 6);
    let pos = 10;
    const saltLength = data[pos++];
    const salt = data.subarray(pos, pos + saltLength);
    pos += saltLength;
    const ivLength = data[pos++];
    const iv = data.subarray(pos, pos + ivLength);
    pos += ivLength;
    if (salt.length !== saltLength || iv.length !== ivLength || pos > data.length) fail("The header is damaged: it ends too early.");
    const header = data.subarray(0, pos);
    const key = await pbkdf2(password, salt, iterations, keyBytes * 8);
    const decrypted = await decryptRaw({ mode, key, iv, ciphertext: data.subarray(pos), aad: mode === "gcm" ? header : undefined });
    if (!decrypted.ok) return fail(mode === "gcm" ? decrypted.error : `${decrypted.error} (${MODE_NAME[mode]} does not authenticate, so a wrong password can look like corrupt padding.)`);
    return decrypted.bytes;
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

// ---------------------------------------------------------------------------------------------
// OpenSSL compatible: openssl enc -aes-256-cbc -pbkdf2 -iter N -md sha256
// ---------------------------------------------------------------------------------------------

const SALTED = encoder.encode("Salted__");

export interface OpenSslOptions {
  keyBits: KeyBits;
  iterations: number;
}

/** "Salted__" + 8-byte salt + AES-CBC ciphertext; key and IV come from PBKDF2-HMAC-SHA256 (key bytes then 16 IV bytes). */
export function encryptOpenSsl(password: string, plaintext: Uint8Array, options: OpenSslOptions, salt: Uint8Array = randomBytes(8)): Promise<BytesResult> {
  return run(async () => {
    if (password === "") fail("Enter a password.");
    const derived = await pbkdf2(password, salt, options.iterations, options.keyBits + 128);
    const key = derived.subarray(0, options.keyBits / 8);
    const iv = derived.subarray(options.keyBits / 8);
    const encrypted = await encryptRaw({ mode: "cbc", key, iv, plaintext });
    if (!encrypted.ok) return fail(encrypted.error);
    return concat(SALTED, salt, encrypted.bytes);
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

export function decryptOpenSsl(password: string, data: Uint8Array, options: OpenSslOptions): Promise<BytesResult> {
  return run(async () => {
    if (password === "") fail("Enter the password.");
    if (data.length < 16 || !SALTED.every((b, i) => data[i] === b)) fail('OpenSSL data starts with "Salted__" (Base64: "U2FsdGVkX1…"). This does not.');
    const salt = data.subarray(8, 16);
    const derived = await pbkdf2(password, salt, options.iterations, options.keyBits + 128);
    const decrypted = await decryptRaw({ mode: "cbc", key: derived.subarray(0, options.keyBits / 8), iv: derived.subarray(options.keyBits / 8), ciphertext: data.subarray(16) });
    if (!decrypted.ok) return fail("Decryption failed: wrong password, or a different key size / iteration count than the one used to encrypt. (AES-CBC does not authenticate, so a wrong password shows up as bad padding.)");
    return decrypted.bytes;
  }).then((r) => (r.ok ? { ok: true, bytes: r.value } : r));
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function readU32(data: Uint8Array, at: number): number {
  return ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type ByteFormat = "base64" | "base64url" | "hex";

export function bytesToText(bytes: Uint8Array, format: ByteFormat): string {
  if (format === "hex") return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return bytesToBase64(bytes, { urlSafe: format === "base64url", padding: format === "base64" });
}

/** Parse Base64 (either alphabet) or hex, whichever the format says; whitespace and 0x / colons are ignored for hex. */
export function textToBytes(text: string, format: ByteFormat, what = "value"): BytesResult {
  if (format === "hex") {
    const clean = text.replace(/\s+/g, "").replace(/^0x/i, "").replace(/:/g, "");
    if (!/^[0-9a-fA-F]*$/.test(clean)) return { ok: false, error: `The ${what} is not hex.` };
    if (clean.length % 2 !== 0) return { ok: false, error: `The ${what} has an odd number of hex digits.` };
    return { ok: true, bytes: Uint8Array.from(clean.match(/../g)?.map((h) => parseInt(h, 16)) ?? []) };
  }
  const decoded = base64ToBytes(text);
  return decoded.ok ? decoded : { ok: false, error: `The ${what} is not valid Base64: ${decoded.error}` };
}
