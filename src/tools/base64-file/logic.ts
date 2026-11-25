import { base64ToBytes, bytesToBase64 } from "../../lib/base64";

/** Base64 <-> files and data URIs: detect the type, build data URIs, and parse them back. */

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));

/** True when the bytes are valid UTF-8 without control characters (other than tab / newlines) in the first 4 KB. */
export function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  const head = bytes.subarray(0, 4096);
  let text: string;
  try {
    // A truncated multi-byte sequence at the cut is fine, so decode non-fatally and look for replacement characters only
    // when the whole input fits in the window.
    text = new TextDecoder("utf-8", { fatal: bytes.length <= 4096 }).decode(head);
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

/** Best-effort file type from the first bytes ("magic numbers"). Falls back to text/plain or application/octet-stream. */
export function sniffMime(bytes: Uint8Array): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  const head6 = ascii(bytes, 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF") {
    const kind = ascii(bytes, 8, 12);
    if (kind === "WEBP") return "image/webp";
    if (kind === "WAVE") return "audio/wav";
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix" || brand === "mif1") return "image/heic";
    return "video/mp4";
  }
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  if (startsWith(bytes, [0x1f, 0x8b])) return "application/gzip";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 4) === "wOFF") return "font/woff";
  if (ascii(bytes, 0, 4) === "wOF2") return "font/woff2";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(bytes, 0, 2) === "BM" && bytes.length > 26) return "image/bmp";

  if (isProbablyText(bytes)) {
    const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
    if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "text/html";
    if (head.startsWith("<?xml")) return "application/xml";
    return "text/plain";
  }
  return "application/octet-stream";
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/json": "json",
  "application/xml": "xml",
  "text/plain": "txt",
  "text/html": "html",
  "text/css": "css",
  "text/csv": "csv",
  "text/javascript": "js",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "font/woff": "woff",
  "font/woff2": "woff2",
};

export function extensionForMime(mime: string): string {
  return EXTENSIONS[mime.toLowerCase().split(";")[0].trim()] ?? "bin";
}

/** Insert a line break every `width` characters (MIME style uses 76). */
export function wrapLines(text: string, width: number): string {
  if (width <= 0) return text;
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join("\n");
}

export type OutputKind = "base64" | "data-uri" | "img-tag" | "css-url";

export interface OutputOptions {
  urlSafe: boolean;
  /** Wrap plain Base64 output at 76 characters. Ignored for data URIs, where a line break would break the URI. */
  wrap: boolean;
}

/** Render bytes as plain Base64, a data URI, an <img> tag or a CSS url(). */
export function formatOutput(bytes: Uint8Array, mime: string, kind: OutputKind, options: OutputOptions): string {
  const base64 = bytesToBase64(bytes, { urlSafe: options.urlSafe });
  if (kind === "base64") return options.wrap ? wrapLines(base64, 76) : base64;
  const uri = `data:${mime};base64,${base64}`;
  if (kind === "data-uri") return uri;
  if (kind === "img-tag") return `<img src="${uri}" alt="">`;
  return `url("${uri}")`;
}

export interface ParsedInput {
  bytes: Uint8Array;
  /** Type declared by a data URI, if any. */
  declaredMime: string | null;
  /** The type to use: the declared one when it is specific, otherwise sniffed from the bytes. */
  mime: string;
  source: "data-uri" | "base64";
  warnings: string[];
}

export type ParseResult = ({ ok: true } & ParsedInput) | { ok: false; error: string };

/** Percent-decode to raw bytes (a data URI without ;base64 holds URL-encoded bytes). */
export function percentDecodeToBytes(text: string): Uint8Array | null {
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%") {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) return null;
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      // Non-ASCII characters are written as their UTF-8 bytes.
      const cp = text.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      out.push(...encoder.encode(ch));
      if (cp > 0xffff) i++;
    }
  }
  return new Uint8Array(out);
}

const GENERIC = new Set(["application/octet-stream", "binary/octet-stream"]);

/** Accepts a data URI (`data:image/png;base64,...`) or bare Base64 / Base64URL, with or without line breaks. */
export function parseBase64Input(input: string): ParseResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Input is empty." };
  const warnings: string[] = [];

  let bytes: Uint8Array;
  let declaredMime: string | null = null;
  let source: ParsedInput["source"] = "base64";

  if (/^data:/i.test(text)) {
    source = "data-uri";
    const comma = text.indexOf(",");
    if (comma === -1) return { ok: false, error: 'This data URI has no "," between its header and its data.' };
    const header = text.slice(5, comma);
    const payload = text.slice(comma + 1);
    const parts = header.split(";").map((p) => p.trim());
    const isBase64 = parts.length > 0 && parts[parts.length - 1].toLowerCase() === "base64";
    const mime = parts[0] && !parts[0].includes("=") ? parts[0].toLowerCase() : "";
    declaredMime = mime || "text/plain";

    if (isBase64) {
      let b64 = payload;
      if (b64.includes("%")) {
        try {
          b64 = decodeURIComponent(b64);
        } catch {
          return { ok: false, error: "The data contains a malformed %-escape." };
        }
      }
      const decoded = base64ToBytes(b64);
      if (!decoded.ok) return { ok: false, error: `Invalid Base64 data: ${decoded.error}` };
      bytes = decoded.bytes;
    } else {
      const decoded = percentDecodeToBytes(payload);
      if (!decoded) return { ok: false, error: "The data contains a malformed %-escape." };
      bytes = decoded;
    }
  } else {
    const decoded = base64ToBytes(text);
    if (!decoded.ok) return { ok: false, error: decoded.error };
    bytes = decoded.bytes;
  }

  const sniffed = sniffMime(bytes);
  let mime = declaredMime && !GENERIC.has(declaredMime) ? declaredMime : sniffed;
  if (declaredMime && !GENERIC.has(declaredMime) && sniffed !== "text/plain" && sniffed !== "application/octet-stream" && sniffed !== declaredMime) {
    // Trust the bytes: a wrong type would make the download or preview misleading.
    warnings.push(`The data URI says ${declaredMime}, but the bytes look like ${sniffed}.`);
    mime = sniffed;
  }
  return { ok: true, bytes, declaredMime, mime, source, warnings };
}
