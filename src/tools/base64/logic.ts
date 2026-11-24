import { base64ToBytes, bytesToBase64 } from "../../lib/base64";

export interface TextEncodeOptions {
  urlSafe: boolean;
  padding: boolean;
}

/** Text -> UTF-8 bytes -> Base64. */
export function encodeText(text: string, options: TextEncodeOptions): string {
  return bytesToBase64(new TextEncoder().encode(text), options);
}

export type DecodeTextResult = { ok: true; text: string } | { ok: false; error: string };

/** Base64 (standard or URL-safe, padded or not) -> UTF-8 text. Fails clearly if the bytes are not valid UTF-8. */
export function decodeText(base64: string): DecodeTextResult {
  const decoded = base64ToBytes(base64);
  if (!decoded.ok) return decoded;
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(decoded.bytes) };
  } catch {
    return {
      ok: false,
      error: `Decoded ${decoded.bytes.length} byte${decoded.bytes.length === 1 ? "" : "s"}, but they are not valid UTF-8 text (probably binary data).`,
    };
  }
}
