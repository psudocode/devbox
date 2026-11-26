/** HOTP (RFC 4226) and TOTP (RFC 6238) one-time passwords, plus otpauth:// URIs. Runs entirely in the browser. */
import { base32Decode, base32Encode } from "../base-encodings/logic";
import { hmac, type Algorithm } from "../hash-generator/logic";

export type OtpAlgorithm = Extract<Algorithm, "SHA-1" | "SHA-256" | "SHA-512">;
export const OTP_ALGORITHMS: OtpAlgorithm[] = ["SHA-1", "SHA-256", "SHA-512"];
export const OTP_DIGITS = [6, 7, 8] as const;

export const DEFAULT_PERIOD = 30;
export const MAX_WINDOW = 10;

export interface OtpParams {
  algorithm: OtpAlgorithm;
  digits: number;
  /** TOTP time step in seconds. */
  period: number;
}

export const DEFAULT_PARAMS: OtpParams = { algorithm: "SHA-1", digits: 6, period: DEFAULT_PERIOD };

export type SecretResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Decode a Base32 secret as shown by authenticator apps: case-insensitive, spaces and missing padding are fine. */
export function parseSecret(text: string): SecretResult {
  const clean = text.replace(/[\s-]+/g, "");
  if (clean === "") return { ok: false, error: "Enter a Base32 secret." };
  const decoded = base32Decode(clean, "rfc4648");
  if (!decoded.ok) return { ok: false, error: `Secret is not valid Base32: ${decoded.error}` };
  if (decoded.bytes.length === 0) return { ok: false, error: "Enter a Base32 secret." };
  return { ok: true, bytes: decoded.bytes };
}

/** Random secret as Base32 (no padding), 20 bytes = 160 bits by default as recommended by RFC 4226. */
export function generateSecret(byteLength = 20, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return base32Encode(random(byteLength), "rfc4648", false);
}

function counterBytes(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError("Counter must be a non-negative safe integer.");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(counter));
  return out;
}

/** HOTP value for a counter (RFC 4226 section 5.3, dynamic truncation). */
export async function hotp(secret: Uint8Array, counter: number, algorithm: OtpAlgorithm = "SHA-1", digits = 6): Promise<string> {
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new RangeError("Digits must be between 6 and 10.");
  const mac = await hmac(algorithm, secret, counterBytes(counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) * 2 ** 24) + (mac[offset + 1] << 16) + (mac[offset + 2] << 8) + mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The TOTP time-step counter for a Unix time in milliseconds. */
export function timeCounter(timeMs: number, period = DEFAULT_PERIOD): number {
  return Math.floor(timeMs / 1000 / period);
}

export interface TotpResult {
  code: string;
  counter: number;
  /** Whole seconds until the code changes. */
  secondsRemaining: number;
  /** 0..1, how much of the period is left. */
  fractionRemaining: number;
}

export async function totp(secret: Uint8Array, timeMs: number, params: OtpParams = DEFAULT_PARAMS): Promise<TotpResult> {
  if (!Number.isInteger(params.period) || params.period < 1 || params.period > 3600) {
    throw new RangeError("Period must be between 1 and 3600 seconds.");
  }
  const counter = timeCounter(timeMs, params.period);
  const code = await hotp(secret, counter, params.algorithm, params.digits);
  const elapsed = timeMs / 1000 - counter * params.period;
  return {
    code,
    counter,
    secondsRemaining: Math.max(1, Math.ceil(params.period - elapsed)),
    fractionRemaining: Math.max(0, 1 - elapsed / params.period),
  };
}

/** Codes for the steps around `timeMs`, e.g. window 1 gives previous, current and next. */
export async function totpWindow(
  secret: Uint8Array,
  timeMs: number,
  params: OtpParams,
  window: number,
): Promise<{ offset: number; code: string }[]> {
  const w = Math.min(MAX_WINDOW, Math.max(0, Math.floor(window)));
  const center = timeCounter(timeMs, params.period);
  const out: { offset: number; code: string }[] = [];
  for (let offset = -w; offset <= w; offset++) {
    if (center + offset < 0) continue;
    out.push({ offset: offset + 0, code: await hotp(secret, center + offset, params.algorithm, params.digits) });
  }
  return out;
}

/** Check a user-typed code against the steps within `window` of now. Returns the matching offset or null. */
export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  timeMs: number,
  params: OtpParams,
  window = 1,
): Promise<number | null> {
  const wanted = code.replace(/\s+/g, "");
  if (!/^\d+$/.test(wanted)) return null;
  const candidates = await totpWindow(secret, timeMs, params, window);
  return candidates.find((c) => c.code === wanted)?.offset ?? null;
}

// ---------------------------------------------------------------- otpauth:// URIs

export interface OtpAuth {
  type: "totp" | "hotp";
  label: string;
  issuer: string;
  secret: string;
  algorithm: OtpAlgorithm;
  digits: number;
  period: number;
  counter: number;
}

export type OtpAuthResult = { ok: true; value: OtpAuth } | { ok: false; error: string };

const ALGORITHM_BY_NAME: Record<string, OtpAlgorithm> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

/** Parse an `otpauth://totp/Issuer:account?secret=...&issuer=...` URI (the content of an authenticator QR code). */
export function parseOtpAuthUri(uri: string): OtpAuthResult {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    return { ok: false, error: "Not a valid URI." };
  }
  if (url.protocol !== "otpauth:") return { ok: false, error: 'The URI must start with "otpauth://".' };
  const type = url.hostname.toLowerCase();
  if (type !== "totp" && type !== "hotp") return { ok: false, error: `Unsupported type "${url.hostname}"; expected totp or hotp.` };

  const q = url.searchParams;
  const secret = (q.get("secret") ?? "").replace(/\s+/g, "").toUpperCase();
  if (!secret) return { ok: false, error: 'The URI has no "secret" parameter.' };

  let label = "";
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    label = url.pathname.replace(/^\//, "");
  }
  const labelIssuer = label.includes(":") ? label.slice(0, label.indexOf(":")).trim() : "";
  const issuer = q.get("issuer") ?? labelIssuer;

  const algorithmName = (q.get("algorithm") ?? "SHA1").toUpperCase().replace("-", "");
  const algorithm = ALGORITHM_BY_NAME[algorithmName];
  if (!algorithm) return { ok: false, error: `Unsupported algorithm "${q.get("algorithm")}"; use SHA1, SHA256 or SHA512.` };

  const digits = q.has("digits") ? Number(q.get("digits")) : 6;
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) return { ok: false, error: `Digits must be 6, 7 or 8; got "${q.get("digits")}".` };
  const period = q.has("period") ? Number(q.get("period")) : DEFAULT_PERIOD;
  if (!Number.isInteger(period) || period < 1 || period > 3600) return { ok: false, error: `Period must be 1 to 3600 seconds; got "${q.get("period")}".` };
  const counter = q.has("counter") ? Number(q.get("counter")) : 0;
  if (!Number.isSafeInteger(counter) || counter < 0) return { ok: false, error: `Counter must be a non-negative integer; got "${q.get("counter")}".` };

  return { ok: true, value: { type, label, issuer, secret, algorithm, digits, period, counter } };
}

export function buildOtpAuthUri(o: Pick<OtpAuth, "type" | "label" | "issuer" | "secret"> & Partial<OtpAuth>): string {
  const algorithm = o.algorithm ?? "SHA-1";
  const digits = o.digits ?? 6;
  const period = o.period ?? DEFAULT_PERIOD;
  const label = o.issuer && !o.label.includes(":") ? `${o.issuer}:${o.label}` : o.label;
  const params = new URLSearchParams();
  params.set("secret", o.secret.replace(/[\s=-]+/g, "").toUpperCase());
  if (o.issuer) params.set("issuer", o.issuer);
  if (algorithm !== "SHA-1") params.set("algorithm", algorithm.replace("-", ""));
  if (digits !== 6) params.set("digits", String(digits));
  if (o.type === "totp" && period !== DEFAULT_PERIOD) params.set("period", String(period));
  if (o.type === "hotp") params.set("counter", String(o.counter ?? 0));
  return `otpauth://${o.type}/${encodeURIComponent(label).replace(/%3A/gi, ":")}?${params.toString()}`;
}
