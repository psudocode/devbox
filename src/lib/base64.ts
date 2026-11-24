/** Base64 helpers on bytes (RFC 4648), shared by tools and the shareable-URL encoding. */

export interface EncodeOptions {
  /** Use the URL-safe alphabet: "-" and "_" instead of "+" and "/". */
  urlSafe?: boolean;
  /** Append "=" padding. Default true. */
  padding?: boolean;
}

export function bytesToBase64(bytes: Uint8Array, options: EncodeOptions = {}): string {
  let binary = "";
  const chunk = 0x8000; // avoid call-stack limits on big inputs
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  let out = btoa(binary);
  if (options.urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_");
  if (options.padding === false) out = out.replace(/=+$/, "");
  return out;
}

export type DecodeResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * Decode Base64 text. Lenient where it is harmless (whitespace, missing padding, either alphabet),
 * strict where input is ambiguous or corrupt (mixed alphabets, bad characters, impossible length).
 */
export function base64ToBytes(text: string): DecodeResult {
  const clean = text.replace(/\s+/g, "");
  if (clean === "") return { ok: true, bytes: new Uint8Array(0) };

  const bad = /[^A-Za-z0-9+/\-_=]/.exec(clean);
  if (bad) return { ok: false, error: `Invalid character "${bad[0]}" at position ${bad.index + 1}` };

  const body = clean.replace(/=+$/, "");
  const padding = clean.length - body.length;
  if (body.includes("=")) return { ok: false, error: 'Padding "=" is only allowed at the end' };
  if (padding > 2) return { ok: false, error: 'Too much "=" padding (at most 2)' };
  if (/[+/]/.test(body) && /[-_]/.test(body)) {
    return { ok: false, error: "Mixes the standard (+ /) and URL-safe (- _) alphabets" };
  }
  if (body.length % 4 === 1) return { ok: false, error: "Invalid length: a Base64 string cannot have this many characters" };
  if (padding > 0 && clean.length % 4 !== 0) return { ok: false, error: 'Padding "=" does not match the length' };

  const standard = body.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return { ok: true, bytes: out };
}
