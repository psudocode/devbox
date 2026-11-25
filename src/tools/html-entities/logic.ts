/** HTML entity encoding and decoding. Decoding uses the browser's own HTML parser, so every named entity works. */

// Names for U+00A0..U+00FF in order (HTML 4 Latin-1 set).
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

const GREEK_UPPER = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega".split(" ");
const GREEK_LOWER = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" ");

const EXTRA: Record<number, string> = {
  0x152: "OElig", 0x153: "oelig", 0x160: "Scaron", 0x161: "scaron", 0x178: "Yuml", 0x192: "fnof", 0x2c6: "circ", 0x2dc: "tilde",
  0x2002: "ensp", 0x2003: "emsp", 0x2009: "thinsp", 0x200c: "zwnj", 0x200d: "zwj", 0x200e: "lrm", 0x200f: "rlm",
  0x2013: "ndash", 0x2014: "mdash", 0x2018: "lsquo", 0x2019: "rsquo", 0x201a: "sbquo", 0x201c: "ldquo", 0x201d: "rdquo", 0x201e: "bdquo",
  0x2020: "dagger", 0x2021: "Dagger", 0x2022: "bull", 0x2026: "hellip", 0x2030: "permil", 0x2032: "prime", 0x2033: "Prime",
  0x2039: "lsaquo", 0x203a: "rsaquo", 0x203e: "oline", 0x2044: "frasl", 0x20ac: "euro", 0x2122: "trade",
  0x2190: "larr", 0x2191: "uarr", 0x2192: "rarr", 0x2193: "darr", 0x2194: "harr", 0x21d2: "rArr", 0x21d4: "hArr",
  0x2200: "forall", 0x2202: "part", 0x2203: "exist", 0x2205: "empty", 0x2207: "nabla", 0x2208: "isin", 0x2209: "notin", 0x220b: "ni",
  0x220f: "prod", 0x2211: "sum", 0x2212: "minus", 0x221a: "radic", 0x221d: "prop", 0x221e: "infin", 0x2220: "ang",
  0x2227: "and", 0x2228: "or", 0x2229: "cap", 0x222a: "cup", 0x222b: "int", 0x2234: "there4", 0x223c: "sim", 0x2245: "cong", 0x2248: "asymp",
  0x2260: "ne", 0x2261: "equiv", 0x2264: "le", 0x2265: "ge", 0x2282: "sub", 0x2283: "sup", 0x2286: "sube", 0x2287: "supe",
  0x2295: "oplus", 0x2297: "otimes", 0x22a5: "perp", 0x22c5: "sdot", 0x2660: "spades", 0x2663: "clubs", 0x2665: "hearts", 0x2666: "diams",
};

/** code point -> entity name */
const NAMES = new Map<number, string>();
LATIN1.split(" ").forEach((name, i) => NAMES.set(0xa0 + i, name));
GREEK_UPPER.forEach((name, i) => name !== "-" && NAMES.set(0x391 + i, name));
GREEK_LOWER.forEach((name, i) => NAMES.set(0x3b1 + i, name));
for (const [cp, name] of Object.entries(EXTRA)) NAMES.set(Number(cp), name);

export type Scope = "minimal" | "non-ascii" | "all";
export type NumberFormat = "named" | "decimal" | "hex";

export interface EncodeOptions {
  /**
   * minimal: only & < > " '
   * non-ascii: minimal plus every character outside printable ASCII
   * all: every character except letters, digits, space and line breaks
   */
  scope: Scope;
  /** How non-minimal characters are written: a name when one exists (else decimal), decimal, or hex. */
  format: NumberFormat;
  /** Use &apos; instead of &#39; (HTML5 and XML; not valid in HTML 4). */
  apos: boolean;
  /** Write hex digits in upper case. */
  upperHex: boolean;
}

const MINIMAL: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function encodeEntities(text: string, options: EncodeOptions): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (ch in MINIMAL) {
      out += MINIMAL[ch];
      continue;
    }
    if (ch === "'") {
      out += options.apos ? "&apos;" : "&#39;";
      continue;
    }
    const keep =
      options.scope === "minimal"
        ? true
        : options.scope === "non-ascii"
          ? (cp >= 0x20 && cp <= 0x7e) || ch === "\n" || ch === "\r" || ch === "\t"
          : /[A-Za-z0-9 \n\r\t]/.test(ch);
    if (keep) {
      out += ch;
      continue;
    }
    const name = options.format === "named" ? NAMES.get(cp) : undefined;
    if (name) out += `&${name};`;
    else if (options.format === "hex") out += `&#x${options.upperHex ? cp.toString(16).toUpperCase() : cp.toString(16)};`;
    else out += `&#${cp};`;
  }
  return out;
}

/**
 * Decode named, decimal and hex entities exactly like a browser would (including legacy forms such as `&copy`
 * without a semicolon). Tags are left alone: only entities are decoded.
 */
export function decodeEntities(text: string): string {
  const el = document.createElement("textarea");
  // Escaping "<" keeps everything but entities as plain text, even "</textarea>".
  el.innerHTML = text.replace(/</g, "&lt;");
  return el.value;
}

/**
 * Entities written with a semicolon that are not valid: an unknown name, or a number that is not a character
 * (zero, beyond U+10FFFF, or a surrogate; browsers turn those into U+FFFD).
 */
export function findUnknownEntities(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|[A-Za-z][A-Za-z0-9]*);/g)) {
    const [entity, dec, hex] = match;
    if (dec !== undefined || hex !== undefined) {
      const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) found.add(entity);
    } else if (decodeEntities(entity) === entity) {
      found.add(entity);
    }
  }
  return [...found];
}

/** The name of a code point, when this tool knows one. */
export function entityName(cp: number): string | undefined {
  return NAMES.get(cp);
}
