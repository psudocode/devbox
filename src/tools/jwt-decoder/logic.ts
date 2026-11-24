import { base64ToBytes } from "../../lib/base64";
import { formatRelative } from "../../lib/time";
import { parseJson, stringifyJson } from "../json-formatter/logic";

/**
 * JWT decoding only. The signature is NOT verified (that needs the key and is a later roadmap item).
 */

export interface DecodedPart {
  /** Decoded UTF-8 text exactly as in the token. */
  text: string;
  /** Pretty-printed JSON if the text is valid JSON, otherwise the raw text. */
  pretty: string;
  /** Parsed value when the text is a JSON object, otherwise null. */
  object: Record<string, unknown> | null;
}

export interface TimeClaim {
  name: "exp" | "nbf" | "iat";
  label: string;
  /** NumericDate: seconds since the epoch (may be fractional). */
  seconds: number;
  iso: string;
}

export interface DecodedJwt {
  header: DecodedPart;
  payload: DecodedPart;
  /** Raw signature segment (base64url); empty for unsecured tokens. */
  signature: string;
  signatureBytes: number;
  algorithm: string | null;
  timeClaims: TimeClaim[];
  warnings: string[];
}

export type DecodeResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

/** Remove whitespace, surrounding quotes and a leading "Bearer " so pasted headers work. */
export function cleanToken(input: string): string {
  return input
    .trim()
    .replace(/^authorization:\s*/i, "")
    .replace(/^bearer\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

function decodePart(segment: string, name: string): { ok: true; part: DecodedPart } | { ok: false; error: string } {
  if (segment === "") return { ok: false, error: `The ${name} is empty` };
  const bytes = base64ToBytes(segment);
  if (!bytes.ok) return { ok: false, error: `The ${name} is not valid Base64url: ${bytes.error}` };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes);
  } catch {
    return { ok: false, error: `The ${name} is not valid UTF-8 text` };
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return { ok: true, part: { text, pretty: text, object: null } };
  }
  const object = parsed.value.type === "object" ? (JSON.parse(text) as Record<string, unknown>) : null;
  return { ok: true, part: { text, pretty: stringifyJson(parsed.value, { indent: 2, sortKeys: false }), object } };
}

const TIME_CLAIMS: { name: TimeClaim["name"]; label: string }[] = [
  { name: "iat", label: "Issued at" },
  { name: "nbf", label: "Not before" },
  { name: "exp", label: "Expires" },
];

export function decodeJwt(input: string): DecodeResult {
  const token = cleanToken(input);
  if (token === "") return { ok: false, error: "Paste a JWT" };

  const segments = token.split(".");
  if (segments.length !== 3) {
    return {
      ok: false,
      error: `A JWT has 3 dot-separated parts (header.payload.signature) but this has ${segments.length}`,
    };
  }
  const [h, p, signature] = segments;

  const header = decodePart(h, "header");
  if (!header.ok) return header;
  const payload = decodePart(p, "payload");
  if (!payload.ok) return payload;

  const warnings: string[] = [];
  if (header.part.object === null) {
    warnings.push("The header is not a JSON object, so this is probably not a JWT.");
  }
  if (payload.part.object === null) {
    warnings.push("The payload is not a JSON object (allowed for JWS, but claims cannot be shown).");
  }

  const alg = header.part.object?.alg;
  const algorithm = typeof alg === "string" ? alg : null;
  if (header.part.object && algorithm === null) warnings.push('The header has no "alg" field.');
  if (algorithm?.toLowerCase() === "none") {
    warnings.push('alg is "none": the token is unsigned and must not be trusted.');
  }
  if (algorithm !== null && algorithm.toLowerCase() !== "none" && signature === "") {
    warnings.push("The signature part is empty although the token claims to be signed.");
  }

  const timeClaims: TimeClaim[] = [];
  for (const { name, label } of TIME_CLAIMS) {
    const value = payload.part.object?.[name];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      warnings.push(`"${name}" should be a number of seconds, found ${JSON.stringify(value)}.`);
      continue;
    }
    const date = new Date(value * 1000);
    if (Number.isNaN(date.getTime())) {
      warnings.push(`"${name}" (${value}) is outside the range of valid dates.`);
      continue;
    }
    timeClaims.push({ name, label, seconds: value, iso: date.toISOString() });
  }

  const decodedSignature = signature === "" ? null : base64ToBytes(signature);
  const signatureBytes = decodedSignature?.ok ? decodedSignature.bytes.length : 0;

  return {
    ok: true,
    jwt: { header: header.part, payload: payload.part, signature, signatureBytes, algorithm, timeClaims, warnings },
  };
}

export type TokenTimeStatus = "expired" | "not-yet-valid" | "valid" | "no-expiry";

/** Time-based status only (exp / nbf). Says nothing about the signature. */
export function timeStatus(claims: readonly TimeClaim[], nowMs: number): TokenTimeStatus {
  const nowSeconds = nowMs / 1000;
  const exp = claims.find((c) => c.name === "exp");
  const nbf = claims.find((c) => c.name === "nbf");
  if (exp && exp.seconds <= nowSeconds) return "expired";
  if (nbf && nbf.seconds > nowSeconds) return "not-yet-valid";
  return exp ? "valid" : "no-expiry";
}

export { formatRelative };
