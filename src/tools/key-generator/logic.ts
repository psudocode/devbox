import { bytesToBase64 } from "../../lib/base64";
import { derToPem } from "../../lib/pem";

/** RSA / ECDSA / Ed25519 key pairs and PBKDF2 key derivation with WebCrypto. */

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser does not provide WebCrypto (crypto.subtle). It needs a secure context (https or localhost).");
  return globalThis.crypto.subtle;
};

export type KeyType = "rsa-2048" | "rsa-3072" | "rsa-4096" | "ec-p256" | "ec-p384" | "ec-p521" | "ed25519";

export const KEY_TYPES: { id: KeyType; label: string; note: string }[] = [
  { id: "rsa-2048", label: "RSA 2048", note: "The usual minimum today." },
  { id: "rsa-3072", label: "RSA 3072", note: "About 128-bit security." },
  { id: "rsa-4096", label: "RSA 4096", note: "Slow to generate (can take several seconds)." },
  { id: "ec-p256", label: "ECDSA P-256 (prime256v1)", note: "ES256, the common choice." },
  { id: "ec-p384", label: "ECDSA P-384 (secp384r1)", note: "ES384." },
  { id: "ec-p521", label: "ECDSA P-521 (secp521r1)", note: "ES512." },
  { id: "ed25519", label: "Ed25519", note: "EdDSA. Needs a recent browser." },
];

export interface GeneratedKeyPair {
  type: KeyType;
  privatePem: string;
  publicPem: string;
  privateJwk: string;
  publicJwk: string;
  /** SHA-256 of the SPKI public key bytes, colon-separated hex (like `openssl pkey -pubout | openssl dgst`). */
  spkiFingerprint: string;
  /** RFC 7638 JWK thumbprint (SHA-256, base64url). */
  jwkThumbprint: string;
}

export type KeyPairResult = { ok: true; pair: GeneratedKeyPair } | { ok: false; error: string };

const hexColon = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(":");

/** RFC 7638: SHA-256 over the JSON of the required members, in alphabetical order. */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  let members: Record<string, unknown>;
  switch (jwk.kty) {
    case "RSA":
      members = { e: jwk.e, kty: jwk.kty, n: jwk.n };
      break;
    case "EC":
      members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
      break;
    case "OKP":
      members = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
      break;
    default:
      throw new Error(`Unsupported key type ${String(jwk.kty)}.`);
  }
  const hash = new Uint8Array(await subtle().digest("SHA-256", new TextEncoder().encode(JSON.stringify(members)) as BufferSource));
  return bytesToBase64(hash, { urlSafe: true, padding: false });
}

function algorithmFor(type: KeyType): RsaHashedKeyGenParams | EcKeyGenParams | { name: "Ed25519" } {
  if (type.startsWith("rsa-")) {
    return {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: Number(type.slice(4)),
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    };
  }
  if (type === "ed25519") return { name: "Ed25519" };
  const curves: Record<"ec-p256" | "ec-p384" | "ec-p521", string> = { "ec-p256": "P-256", "ec-p384": "P-384", "ec-p521": "P-521" };
  return { name: "ECDSA", namedCurve: curves[type as keyof typeof curves] };
}

const stripJwk = (jwk: JsonWebKey): JsonWebKey => {
  // `alg`, `key_ops` and `ext` describe how this tool created the key, not the key itself.
  const clean = { ...jwk };
  delete clean.alg;
  delete clean.key_ops;
  delete clean.ext;
  return clean;
};

export async function generateKeyPair(type: KeyType): Promise<KeyPairResult> {
  try {
    const pair = (await subtle().generateKey(algorithmFor(type), true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", pair.privateKey));
    const spki = new Uint8Array(await subtle().exportKey("spki", pair.publicKey));
    const privateJwk = stripJwk(await subtle().exportKey("jwk", pair.privateKey));
    const publicJwk = stripJwk(await subtle().exportKey("jwk", pair.publicKey));
    const fingerprint = new Uint8Array(await subtle().digest("SHA-256", spki as BufferSource));
    return {
      ok: true,
      pair: {
        type,
        privatePem: derToPem(pkcs8, "PRIVATE KEY"),
        publicPem: derToPem(spki, "PUBLIC KEY"),
        privateJwk: JSON.stringify(privateJwk, null, 2),
        publicJwk: JSON.stringify(publicJwk, null, 2),
        spkiFingerprint: hexColon(fingerprint),
        jwkThumbprint: await jwkThumbprint(publicJwk),
      },
    };
  } catch (err) {
    if (type === "ed25519" && err instanceof Error && /not supported|unrecognized|unsupported/i.test(`${err.name} ${err.message}`)) {
      return { ok: false, error: "This browser does not support Ed25519 in WebCrypto yet. Try a current Chrome, Edge, Firefox or Safari, or use ECDSA P-256." };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// PBKDF2
// ---------------------------------------------------------------------------------------------

export type Pbkdf2Hash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

export const PBKDF2_MAX_ITERATIONS = 10_000_000;
export const PBKDF2_MAX_BYTES = 1024;

export interface Pbkdf2Options {
  password: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  hash: Pbkdf2Hash;
  /** Output length in bytes. */
  length: number;
}

export type Pbkdf2Result = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

export async function derivePbkdf2(o: Pbkdf2Options): Promise<Pbkdf2Result> {
  if (!Number.isInteger(o.iterations) || o.iterations < 1 || o.iterations > PBKDF2_MAX_ITERATIONS) {
    return { ok: false, error: `Iterations must be a whole number from 1 to ${PBKDF2_MAX_ITERATIONS.toLocaleString("en-US")}.` };
  }
  if (!Number.isInteger(o.length) || o.length < 1 || o.length > PBKDF2_MAX_BYTES) {
    return { ok: false, error: `Output length must be from 1 to ${PBKDF2_MAX_BYTES} bytes.` };
  }
  try {
    const base = await subtle().importKey("raw", o.password as BufferSource, "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle().deriveBits({ name: "PBKDF2", salt: o.salt as BufferSource, iterations: o.iterations, hash: o.hash }, base, o.length * 8);
    return { ok: true, bytes: new Uint8Array(bits) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Rough guidance from OWASP's Password Storage Cheat Sheet (2023). */
export const RECOMMENDED_ITERATIONS: Record<Pbkdf2Hash, number> = {
  "SHA-1": 1_300_000,
  "SHA-256": 600_000,
  "SHA-384": 400_000,
  "SHA-512": 210_000,
};
