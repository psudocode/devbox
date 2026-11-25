/** Unicode escapes: text <-> \uXXXX and friends. Works on code points, so emoji and other astral characters are single units. */

export type Style = "js" | "es6" | "python" | "css" | "codepoint" | "percent-u";
export type Scope = "non-ascii" | "all";

export interface EncodeOptions {
  style: Style;
  /** non-ascii: keep printable ASCII as is; all: escape every character. */
  scope: Scope;
  /** For \-based styles: write a backslash as \\ so the result can be decoded again. */
  escapeBackslash: boolean;
  /** Upper-case hex digits. */
  upper: boolean;
}

const hex = (n: number, width: number, upper: boolean) => {
  const s = n.toString(16).padStart(width, "0");
  return upper ? s.toUpperCase() : s;
};

const SHORT: Record<number, string> = { 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };

function escapeCodePoint(cp: number, o: EncodeOptions): string {
  const up = o.upper;
  switch (o.style) {
    case "js":
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        return `\\u${hex(0xd800 + (v >> 10), 4, up)}\\u${hex(0xdc00 + (v & 0x3ff), 4, up)}`;
      }
      return `\\u${hex(cp, 4, up)}`;
    case "es6":
      return `\\u{${hex(cp, 1, up)}}`;
    case "python":
      return cp > 0xffff ? `\\U${hex(cp, 8, up)}` : `\\u${hex(cp, 4, up)}`;
    case "css":
      // A trailing space ends the escape, unless it already has the maximum six digits.
      return `\\${hex(cp, 1, up)}${hex(cp, 1, up).length < 6 ? " " : ""}`;
    case "codepoint":
      return `U+${hex(cp, 4, true)}`;
    case "percent-u":
      // The legacy escape() format is UTF-16 based.
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        return `%u${hex(0xd800 + (v >> 10), 4, up)}%u${hex(0xdc00 + (v & 0x3ff), 4, up)}`;
      }
      return `%u${hex(cp, 4, up)}`;
  }
}

/** Escape text. With scope "non-ascii", printable ASCII stays readable and common control characters use \n \t \r. */
export function encodeUnicode(text: string, options: EncodeOptions): string {
  const backslashStyle = options.style === "js" || options.style === "es6" || options.style === "python";
  const parts: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (options.scope === "non-ascii" && cp >= 0x20 && cp <= 0x7e) {
      parts.push(ch === "\\" && backslashStyle && options.escapeBackslash ? "\\\\" : ch);
      continue;
    }
    if (options.scope === "non-ascii" && backslashStyle && SHORT[cp]) {
      parts.push(SHORT[cp]);
      continue;
    }
    if (options.scope === "non-ascii" && cp < 0x20 && options.style === "css") {
      parts.push(escapeCodePoint(cp, options));
      continue;
    }
    parts.push(escapeCodePoint(cp, options));
  }
  const joined = parts.join(options.style === "codepoint" ? " " : "");
  return joined;
}

export interface DecodeResult {
  text: string;
  /** Things that were left alone or replaced, in the order found. */
  warnings: string[];
  /** Number of escape sequences decoded. */
  count: number;
}

const MAX_CODE_POINT = 0x10ffff;

function fromCodePointSafe(cp: number, label: string, warnings: string[]): string {
  if (cp > MAX_CODE_POINT) {
    warnings.push(`${label} is beyond U+10FFFF; replaced with U+FFFD.`);
    return "�";
  }
  return String.fromCodePoint(cp);
}

const SIMPLE: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0", "\\": "\\", "'": "'", '"': '"', "/": "/" };

// One alternative per escape, so a single left-to-right pass handles mixed input.
const BACKSLASH = /\\u\{([0-9a-fA-F]{1,})\}|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})|\\x([0-9a-fA-F]{2})|\\([nrtbfv0\\'"/])/g;
// Case sensitive on purpose: \u (4 digits) and \U (8 digits) are different escapes.
const MIXED = new RegExp(`${BACKSLASH.source}|[Uu]\\+([0-9a-fA-F]{4,6})|%[uU]([0-9a-fA-F]{4})`, "g");
const CSS = /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g;

/**
 * Decode escapes back to text. "auto" understands \uXXXX, \u{X}, \UXXXXXXXX, \xXX, \n \t ..., U+XXXX and %uXXXX in one pass;
 * "css" decodes CSS escapes (\E9 ), which clash with plain backslashes and so are not part of "auto".
 */
export function decodeUnicode(text: string, mode: "auto" | "css"): DecodeResult {
  const warnings: string[] = [];
  let count = 0;

  if (mode === "css") {
    const out = text.replace(CSS, (_m, digits: string | undefined, literal: string | undefined) => {
      count++;
      if (literal !== undefined) return literal;
      const cp = parseInt(digits!, 16);
      if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff) || cp > MAX_CODE_POINT) {
        warnings.push(`\\${digits} is not a valid character; replaced with U+FFFD.`);
        return "�";
      }
      return String.fromCodePoint(cp);
    });
    return { text: out, warnings, count };
  }

  // A list like "U+0041 U+0042" is the code point notation: the spaces only separate the items.
  const source = /^\s*(?:[Uu]\+[0-9a-fA-F]{4,6}\s*)+$/.test(text) ? text.replace(/\s+/g, "") : text;

  // Code units are collected as a string, so 🐙 combines into one emoji by itself.
  const out = source.replace(
    MIXED,
    (m, braced?: string, u4?: string, u8?: string, x2?: string, simple?: string, plus?: string, pct?: string) => {
      count++;
      if (braced !== undefined) return fromCodePointSafe(parseInt(braced, 16), m, warnings);
      if (u4 !== undefined) return String.fromCharCode(parseInt(u4, 16));
      if (u8 !== undefined) return fromCodePointSafe(parseInt(u8, 16), m, warnings);
      if (x2 !== undefined) return String.fromCharCode(parseInt(x2, 16));
      if (simple !== undefined) return SIMPLE[simple];
      if (plus !== undefined) return fromCodePointSafe(parseInt(plus, 16), m, warnings);
      return String.fromCharCode(parseInt(pct!, 16));
    },
  );
  // A surrogate that did not find its partner is not valid text.
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && out.charCodeAt(i + 1) >= 0xdc00 && out.charCodeAt(i + 1) <= 0xdfff) i++;
    else if (c >= 0xd800 && c <= 0xdfff) {
      warnings.push(`Lone surrogate U+${c.toString(16).toUpperCase()} at position ${i}; it is not a valid character.`);
      break;
    }
  }
  return { text: out, warnings, count };
}

/** Quick facts about a text, for the status line. */
export function describeText(text: string): { codePoints: number; utf16Units: number; utf8Bytes: number; astral: number } {
  let codePoints = 0;
  let astral = 0;
  for (const ch of text) {
    codePoints++;
    if (ch.codePointAt(0)! > 0xffff) astral++;
  }
  return { codePoints, utf16Units: text.length, utf8Bytes: new TextEncoder().encode(text).length, astral };
}
