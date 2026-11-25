import { base64ToBytes, bytesToBase64 } from "../../lib/base64";
import { pemToDer } from "../../lib/pem";
import { cleanToken, decodeJwt, timeStatus, type DecodedJwt, type TokenTimeStatus } from "../jwt-decoder/logic";

/** Sign and verify JWTs (JWS compact serialization) with the browser's WebCrypto. Nothing leaves the browser. */

export const ALGORITHMS = [
  "HS256", "HS384", "HS512",
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512",
] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

type Family = "HS" | "RS" | "PS" | "ES";

const family = (alg: Algorithm): Family => alg.slice(0, 2) as Family;
const hashName = (alg: Algorithm) => `SHA-${alg.slice(2)}`;
const CURVE: Record<"ES256" | "ES384" | "ES512", { name: string; size: number }> = {
  ES256: { name: "P-256", size: 32 },
  ES384: { name: "P-384", size: 48 },
  ES512: { name: "P-521", size: 66 },
};

export type SecretEncoding = "utf8" | "base64";

export interface KeyOptions {
  /** HS*: how to read the secret text. */
  secretEncoding: SecretEncoding;
}

const encoder = new TextEncoder();

const b64url = (bytes: Uint8Array) => bytesToBase64(bytes, { urlSafe: true, padding: false });
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser does not provide WebCrypto (crypto.subtle). It needs a secure context (https or localhost).");
  return globalThis.crypto.subtle;
};

function importAlgorithm(alg: Algorithm): RsaHashedImportParams | EcKeyImportParams | HmacImportParams {
  switch (family(alg)) {
    case "HS":
      return { name: "HMAC", hash: hashName(alg) };
    case "RS":
      return { name: "RSASSA-PKCS1-v1_5", hash: hashName(alg) };
    case "PS":
      return { name: "RSA-PSS", hash: hashName(alg) };
    case "ES":
      return { name: "ECDSA", namedCurve: CURVE[alg as keyof typeof CURVE].name };
  }
}

function signParams(alg: Algorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  switch (family(alg)) {
    case "HS":
      return { name: "HMAC" };
    case "RS":
      return { name: "RSASSA-PKCS1-v1_5" };
    // RFC 7518: the salt is as long as the hash output.
    case "PS":
      return { name: "RSA-PSS", saltLength: Number(alg.slice(2)) / 8 };
    case "ES":
      return { name: "ECDSA", hash: hashName(alg) };
  }
}

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth"];

class KeyError extends Error {}

/**
 * Import a key for `alg`. HS: the secret. RS/PS/ES: a PEM (PKCS#8 private key or SPKI public key) or a JWK.
 * When verifying with a private key, the public half is derived from it.
 */
async function importKey(alg: Algorithm, keyText: string, usage: "sign" | "verify", options: KeyOptions): Promise<CryptoKey> {
  const algorithm = importAlgorithm(alg);
  const text = keyText.trim();
  if (text === "") throw new KeyError(family(alg) === "HS" ? "Enter the secret." : "Enter the key (PEM or JWK).");

  if (family(alg) === "HS") {
    let raw: Uint8Array;
    if (options.secretEncoding === "base64") {
      const decoded = base64ToBytes(text);
      if (!decoded.ok) throw new KeyError(`The secret is not valid Base64: ${decoded.error}`);
      raw = decoded.bytes;
    } else {
      raw = encoder.encode(keyText); // exactly as typed, including spaces
    }
    if (raw.length === 0) throw new KeyError("The secret is empty.");
    return subtle().importKey("raw", raw as BufferSource, algorithm, false, [usage]);
  }

  if (text.startsWith("{")) {
    let jwk: JsonWebKey;
    try {
      jwk = JSON.parse(text) as JsonWebKey;
    } catch {
      throw new KeyError("The key looks like JSON but is not valid JSON.");
    }
    return importJwk(alg, jwk, usage);
  }

  const pem = pemToDer(text);
  if (!pem.ok) throw new KeyError(pem.error);
  const hint = (label: string) =>
    `A "${label}" block cannot be used directly. Convert it to PKCS#8, e.g. ${label === "RSA PRIVATE KEY" || label === "EC PRIVATE KEY" ? "openssl pkcs8 -topk8 -nocrypt -in key.pem" : "openssl rsa -RSAPublicKey_in -pubout"}.`;
  if (["RSA PRIVATE KEY", "EC PRIVATE KEY", "RSA PUBLIC KEY"].includes(pem.label)) throw new KeyError(hint(pem.label));
  if (pem.label === "CERTIFICATE") throw new KeyError("Paste the public key (BEGIN PUBLIC KEY), not the certificate. Extract it with: openssl x509 -in cert.pem -pubkey -noout");

  if (pem.label === "PRIVATE KEY") {
    let key: CryptoKey;
    try {
      // Extractable, so that verifying with a private key can derive the public half from it.
      key = await subtle().importKey("pkcs8", pem.der as BufferSource, algorithm, true, ["sign"]);
    } catch {
      throw new KeyError(`Could not read this PKCS#8 private key as a${family(alg) === "ES" ? "n" : ""} ${alg} key. Check that the key type${family(alg) === "ES" ? " and curve" : ""} match the algorithm.`);
    }
    if (usage === "sign") return key;
    // Verifying with a private key: derive the public key from it.
    const jwk = await subtle().exportKey("jwk", key);
    for (const field of PRIVATE_JWK_FIELDS) delete jwk[field as keyof JsonWebKey];
    return importJwk(alg, jwk, "verify");
  }
  if (pem.label === "PUBLIC KEY") {
    if (usage === "sign") throw new KeyError("Signing needs a private key (BEGIN PRIVATE KEY), not a public key.");
    try {
      return await subtle().importKey("spki", pem.der as BufferSource, algorithm, false, ["verify"]);
    } catch {
      throw new KeyError(`Could not read this public key as a${family(alg) === "ES" ? "n" : ""} ${alg} key. Check that the key type${family(alg) === "ES" ? " and curve" : ""} match the algorithm.`);
    }
  }
  throw new KeyError(`Unsupported PEM block "${pem.label}". Use "PRIVATE KEY" (PKCS#8) or "PUBLIC KEY" (SPKI).`);
}

async function importJwk(alg: Algorithm, jwk: JsonWebKey, usage: "sign" | "verify"): Promise<CryptoKey> {
  const algorithm = importAlgorithm(alg);
  const wanted = family(alg) === "ES" ? "EC" : "RSA";
  if (jwk.kty !== wanted) throw new KeyError(`This JWK has kty "${String(jwk.kty)}", but ${alg} needs "${wanted}".`);
  if (family(alg) === "ES" && jwk.crv !== CURVE[alg as keyof typeof CURVE].name) {
    throw new KeyError(`This JWK uses curve ${String(jwk.crv)}, but ${alg} needs ${CURVE[alg as keyof typeof CURVE].name}.`);
  }
  if (usage === "sign" && !jwk.d) throw new KeyError("Signing needs a private key: this JWK has no private part (\"d\").");
  const clean: JsonWebKey = { ...jwk, ext: true };
  delete clean.alg;
  delete clean.use;
  delete clean.key_ops;
  if (usage === "verify") for (const field of PRIVATE_JWK_FIELDS) delete clean[field as keyof JsonWebKey];
  try {
    return await subtle().importKey("jwk", clean, algorithm, false, [usage]);
  } catch {
    throw new KeyError("Could not use this JWK. Check that it is complete and matches the algorithm.");
  }
}

// ---------------------------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------------------------

export type SignResult = { ok: true; token: string; header: string; warnings: string[] } | { ok: false; error: string };

function parseObject(text: string, name: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `The ${name} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: `The ${name} must be a JSON object.` };
  return { ok: true, value: value as Record<string, unknown> };
}

/** Sign `header` + `payload` (JSON object texts). The header's alg is set to the chosen algorithm. */
export async function signJwt(input: { header: string; payload: string; alg: Algorithm; key: string; options: KeyOptions }): Promise<SignResult> {
  const header = parseObject(input.header, "header");
  if (!header.ok) return header;
  const payload = parseObject(input.payload, "payload");
  if (!payload.ok) return payload;

  const warnings: string[] = [];
  if (header.value.alg !== undefined && header.value.alg !== input.alg) {
    warnings.push(`The header said alg "${String(header.value.alg)}"; it was replaced with "${input.alg}" so it matches the signature.`);
  }
  // Canonical order: alg, typ, then any other parameters as given.
  const finalHeader: Record<string, unknown> = { alg: input.alg, typ: header.value.typ ?? "JWT" };
  for (const [name, value] of Object.entries(header.value)) {
    if (name !== "alg" && name !== "typ") finalHeader[name] = value;
  }
  const headerText = JSON.stringify(finalHeader);

  try {
    const key = await importKey(input.alg, input.key, "sign", input.options);
    if (family(input.alg) === "HS" && input.options.secretEncoding === "utf8") {
      const length = encoder.encode(input.key).length;
      const min = Number(input.alg.slice(2)) / 8;
      if (length < min) warnings.push(`The secret is ${length} bytes; RFC 7518 requires at least ${min} bytes for ${input.alg}.`);
    }
    const signingInput = `${b64url(encoder.encode(headerText))}.${b64url(encoder.encode(JSON.stringify(payload.value)))}`;
    const signature = new Uint8Array(await subtle().sign(signParams(input.alg), key, encoder.encode(signingInput) as BufferSource));
    return { ok: true, token: `${signingInput}.${b64url(signature)}`, header: headerText, warnings };
  } catch (err) {
    if (err instanceof KeyError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------

export interface VerifyOutcome {
  /** True only when the signature matches. */
  signatureValid: boolean;
  decoded: DecodedJwt;
  time: TokenTimeStatus;
  warnings: string[];
}

export type VerifyResult = ({ ok: true } & VerifyOutcome) | { ok: false; error: string };

/**
 * Verify a token's signature. The algorithm is the one YOU choose, never the one the token claims: a token whose
 * header says something else (or "none") is rejected, which prevents algorithm-confusion attacks.
 */
export async function verifyJwt(input: { token: string; alg: Algorithm; key: string; options: KeyOptions; nowMs: number }): Promise<VerifyResult> {
  const decodedResult = decodeJwt(input.token);
  if (!decodedResult.ok) return decodedResult;
  const decoded = decodedResult.jwt;

  const parts = cleanToken(input.token).split(".");
  if (parts.length !== 3) return { ok: false, error: "A signed JWT has three dot-separated parts: header.payload.signature." };
  const headerAlg = decoded.algorithm;
  if (headerAlg === null) return { ok: false, error: "The token header has no alg." };
  if (headerAlg.toLowerCase() === "none") return { ok: false, error: 'The token says alg "none" (unsigned). It is not accepted: there is no signature to verify.' };
  if (headerAlg !== input.alg) {
    return { ok: false, error: `The token header says alg "${headerAlg}" but you chose ${input.alg}. Pick the algorithm you expect; the token's own claim is never trusted.` };
  }
  if (parts[2] === "") return { ok: false, error: "The token has no signature." };

  const signature = base64ToBytes(parts[2]);
  if (!signature.ok) return { ok: false, error: `The signature is not valid Base64url: ${signature.error}` };

  const warnings: string[] = [];
  try {
    const key = await importKey(input.alg, input.key, "verify", input.options);
    let valid = false;
    const expectedLength = family(input.alg) === "ES" ? CURVE[input.alg as keyof typeof CURVE].size * 2 : null;
    if (expectedLength !== null && signature.bytes.length !== expectedLength) {
      warnings.push(`An ${input.alg} signature is ${expectedLength} bytes (raw r‖s), this one is ${signature.bytes.length}. DER-encoded signatures are not valid in a JWT.`);
    } else {
      valid = await subtle().verify(signParams(input.alg), key, signature.bytes as BufferSource, encoder.encode(`${parts[0]}.${parts[1]}`) as BufferSource);
    }
    return { ok: true, signatureValid: valid, decoded, time: timeStatus(decoded.timeClaims, input.nowMs), warnings };
  } catch (err) {
    if (err instanceof KeyError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------------------------

/** Set a numeric claim (iat / exp / nbf) in a payload JSON text; returns the new pretty-printed text. */
export function setClaim(payloadText: string, claim: "iat" | "exp" | "nbf", seconds: number): string {
  const parsed = parseObject(payloadText.trim() === "" ? "{}" : payloadText, "payload");
  if (!parsed.ok) return payloadText;
  return JSON.stringify({ ...parsed.value, [claim]: Math.floor(seconds) }, null, 2);
}
