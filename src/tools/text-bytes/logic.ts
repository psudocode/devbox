/** Text <-> bytes shown as hex, binary, decimal or octal, with a choice of character encodings. */

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "latin1" | "ascii";
export type Base = 16 | 2 | 10 | 8;
export type Separator = "space" | "comma" | "newline" | "none";
export type Prefix = "none" | "0x" | "\\x" | "%";

export type BytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };
export type TextResult = { ok: true; text: string } | { ok: false; error: string };

export function encodeText(text: string, encoding: Encoding): BytesResult {
  switch (encoding) {
    case "utf-8":
      return { ok: true, bytes: new TextEncoder().encode(text) };
    case "utf-16le":
    case "utf-16be": {
      const little = encoding === "utf-16le";
      const bytes = new Uint8Array(text.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), little);
      return { ok: true, bytes };
    }
    case "latin1":
    case "ascii": {
      const max = encoding === "ascii" ? 0x7f : 0xff;
      const bytes = new Uint8Array(text.length);
      let index = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp > max) {
          return {
            ok: false,
            error: `"${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, "0")}) cannot be written in ${encoding === "ascii" ? "ASCII" : "Latin-1"}; use UTF-8 or UTF-16.`,
          };
        }
        bytes[index++] = cp;
      }
      return { ok: true, bytes: bytes.subarray(0, index) };
    }
  }
}

export function decodeBytes(bytes: Uint8Array, encoding: Encoding): TextResult {
  switch (encoding) {
    case "utf-8":
      try {
        return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
      } catch {
        return { ok: false, error: "These bytes are not valid UTF-8. Try another encoding, such as Latin-1." };
      }
    case "utf-16le":
    case "utf-16be": {
      if (bytes.length % 2 !== 0) return { ok: false, error: `UTF-16 needs an even number of bytes; got ${bytes.length}.` };
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let text = "";
      for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(view.getUint16(i, encoding === "utf-16le"));
      return { ok: true, text };
    }
    case "latin1":
      return { ok: true, text: Array.from(bytes, (b) => String.fromCharCode(b)).join("") };
    case "ascii": {
      const bad = bytes.findIndex((b) => b > 0x7f);
      if (bad !== -1) return { ok: false, error: `Byte ${bad + 1} (${bytes[bad]}) is above 127, so it is not ASCII.` };
      return { ok: true, text: Array.from(bytes, (b) => String.fromCharCode(b)).join("") };
    }
  }
}

const PAD: Record<Base, number> = { 16: 2, 2: 8, 8: 3, 10: 1 };

export interface FormatOptions {
  base: Base;
  separator: Separator;
  prefix: Prefix;
  upper: boolean;
  /** Pad decimal to three digits (007) so columns line up. */
  padDecimal: boolean;
}

const SEPARATORS: Record<Separator, string> = { space: " ", comma: ", ", newline: "\n", none: "" };

export function formatByteList(bytes: Uint8Array, o: FormatOptions): string {
  const width = o.base === 10 && o.padDecimal ? 3 : PAD[o.base];
  const items = Array.from(bytes, (b) => {
    let digits = b.toString(o.base).padStart(width, "0");
    if (o.upper) digits = digits.toUpperCase();
    return o.prefix === "none" ? digits : `${o.prefix}${digits}`;
  });
  return items.join(SEPARATORS[o.separator]);
}

const DIGITS: Record<Base, RegExp> = {
  16: /^[0-9a-fA-F]+$/,
  2: /^[01]+$/,
  8: /^[0-7]+$/,
  10: /^[0-9]+$/,
};

const BASE_NAME: Record<Base, string> = { 16: "hex", 2: "binary", 8: "octal", 10: "decimal" };

/**
 * Parse a list of byte values. Accepts spaces, commas, semicolons, new lines, and the prefixes 0x, \x, % (hex) and 0b / 0o.
 * Without separators, hex and binary are read as 2-digit / 8-digit groups.
 */
export function parseByteList(text: string, base: Base): BytesResult {
  let source = text.trim();
  if (source === "") return { ok: true, bytes: new Uint8Array(0) };

  // Prefixes turn into separators.
  source = source.replace(/0[xX]|\\[xX]|%|0[bB]|0[oO]/g, (m) => {
    const isHexPrefix = m === "%" || m.toLowerCase() === "\\x" || m.toLowerCase() === "0x";
    // Do not eat the leading 0 of a decimal or octal number such as "0b" inside another base's digits.
    if (base === 16 ? isHexPrefix : base === 2 ? m.toLowerCase() === "0b" : base === 8 ? m.toLowerCase() === "0o" : false) return " ";
    return m;
  });

  let tokens = source.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 1 && (base === 16 || base === 2)) {
    const group = PAD[base];
    const only = tokens[0];
    if (only.length > group && DIGITS[base].test(only)) {
      if (only.length % group !== 0) {
        return { ok: false, error: `${only.length} ${BASE_NAME[base]} digits cannot be split into whole bytes (${group} digits each).` };
      }
      tokens = only.match(new RegExp(`.{${group}}`, "g")) ?? [];
    }
  }

  const bytes = new Uint8Array(tokens.length);
  for (const [i, token] of tokens.entries()) {
    if (!DIGITS[base].test(token)) {
      return { ok: false, error: `"${token}" is not a ${BASE_NAME[base]} number (item ${i + 1}).` };
    }
    const value = parseInt(token, base);
    if (value > 255) return { ok: false, error: `"${token}" is ${value}, which does not fit in one byte (0–255) (item ${i + 1}).` };
    bytes[i] = value;
  }
  return { ok: true, bytes };
}

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

const CONTROL_NAMES = [
  "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL", "BS", "HT", "LF", "VT", "FF", "CR", "SO", "SI",
  "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB", "CAN", "EM", "SUB", "ESC", "FS", "GS", "RS", "US",
];

const CONTROL_DESCRIPTIONS: Record<string, string> = {
  NUL: "Null", SOH: "Start of heading", STX: "Start of text", ETX: "End of text", EOT: "End of transmission", ENQ: "Enquiry",
  ACK: "Acknowledge", BEL: "Bell", BS: "Backspace", HT: "Horizontal tab", LF: "Line feed", VT: "Vertical tab", FF: "Form feed",
  CR: "Carriage return", SO: "Shift out", SI: "Shift in", DLE: "Data link escape", DC1: "Device control 1 (XON)", DC2: "Device control 2",
  DC3: "Device control 3 (XOFF)", DC4: "Device control 4", NAK: "Negative acknowledge", SYN: "Synchronous idle", ETB: "End of transmission block",
  CAN: "Cancel", EM: "End of medium", SUB: "Substitute", ESC: "Escape", FS: "File separator", GS: "Group separator", RS: "Record separator",
  US: "Unit separator", DEL: "Delete", SP: "Space",
};

export interface AsciiRow {
  dec: number;
  hex: string;
  oct: string;
  bin: string;
  /** Printable character, or "" for control characters. */
  char: string;
  /** Abbreviation for control characters (LF), "SP" for space. */
  abbr: string;
  description: string;
}

export function asciiTable(): AsciiRow[] {
  return Array.from({ length: 128 }, (_, dec) => {
    const abbr = dec < 32 ? CONTROL_NAMES[dec] : dec === 32 ? "SP" : dec === 127 ? "DEL" : "";
    return {
      dec,
      hex: dec.toString(16).toUpperCase().padStart(2, "0"),
      oct: dec.toString(8).padStart(3, "0"),
      bin: dec.toString(2).padStart(8, "0"),
      char: abbr === "" ? String.fromCharCode(dec) : abbr === "SP" ? " " : "",
      abbr,
      description: abbr === "" ? "" : CONTROL_DESCRIPTIONS[abbr],
    };
  });
}

/** Filter the table by a decimal / hex (0x41) / character / name query. */
export function searchAscii(rows: AsciiRow[], query: string): AsciiRow[] {
  const q = query.trim();
  if (q === "") return rows;
  const lower = q.toLowerCase();
  const asNumber = /^0x[0-9a-f]+$/i.test(q) ? parseInt(q, 16) : /^\d+$/.test(q) ? Number(q) : null;
  return rows.filter(
    (r) =>
      (asNumber !== null && r.dec === asNumber) ||
      r.char === q ||
      r.abbr.toLowerCase() === lower ||
      // Descriptions are searched by words, not by single letters ("a" means the character a).
      (lower.length >= 3 && r.description.toLowerCase().includes(lower)),
  );
}

export interface CharRow {
  /** The character itself (or a visible stand-in for control characters). */
  display: string;
  codePoint: string;
  utf8: string;
  utf16: string;
  /** Short name for ASCII control characters and the space. */
  name: string;
}

const hexByte = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");

/** One row per code point, with its UTF-8 bytes and UTF-16 code units. */
export function characterTable(text: string, limit = 200): { rows: CharRow[]; total: number } {
  const rows: CharRow[] = [];
  let total = 0;
  const encoder = new TextEncoder();
  for (const ch of text) {
    total++;
    if (rows.length >= limit) continue;
    const cp = ch.codePointAt(0)!;
    const units: string[] = [];
    for (let i = 0; i < ch.length; i++) units.push(ch.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0"));
    const abbr = cp < 32 ? CONTROL_NAMES[cp] : cp === 127 ? "DEL" : cp === 32 ? "SP" : "";
    rows.push({
      // Control characters and the space are shown with their Unicode "control picture" symbols so they are visible.
      display: cp < 32 ? String.fromCodePoint(0x2400 + cp) : cp === 127 ? "␡" : cp === 32 ? "␠" : ch,
      codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
      utf8: Array.from(encoder.encode(ch), hexByte).join(" "),
      utf16: units.join(" "),
      name: abbr ? CONTROL_DESCRIPTIONS[abbr] : "",
    });
  }
  return { rows, total };
}
