/** Base32 (RFC 4648 and Crockford), Base58 and Punycode (RFC 3492), written without dependencies. */

export type BytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };
export type TextResult = { ok: true; text: string } | { ok: false; error: string };

// ---------------------------------------------------------------------------------------------
// Base32
// ---------------------------------------------------------------------------------------------

export type Base32Variant = "rfc4648" | "hex" | "crockford";

const BASE32_ALPHABETS: Record<Base32Variant, string> = {
  rfc4648: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
  hex: "0123456789ABCDEFGHIJKLMNOPQRSTUV",
  crockford: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
};

export function base32Encode(bytes: Uint8Array, variant: Base32Variant, padding: boolean): string {
  const alphabet = BASE32_ALPHABETS[variant];
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  // Crockford has no padding; the others pad to a multiple of 8 characters.
  if (padding && variant !== "crockford") while (out.length % 8 !== 0) out += "=";
  return out;
}

/** Decode Base32. Case-insensitive; spaces and (for Crockford) hyphens are ignored; Crockford O/I/L are read as 0/1/1. */
export function base32Decode(text: string, variant: Base32Variant): BytesResult {
  const alphabet = BASE32_ALPHABETS[variant];
  let clean = text.replace(/\s+/g, "").toUpperCase();
  if (variant === "crockford") clean = clean.replace(/-/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");

  const body = clean.replace(/=+$/, "");
  const padLength = clean.length - body.length;
  if (body.includes("=")) return { ok: false, error: 'Padding "=" is only allowed at the end.' };
  if (variant === "crockford" && padLength > 0) return { ok: false, error: "Crockford Base32 does not use padding." };
  if (padLength > 0 && clean.length % 8 !== 0) return { ok: false, error: `Padded Base32 must be a multiple of 8 characters long; got ${clean.length}.` };

  // Report a bad character before a bad length: it is the more useful message.
  const original = text.replace(/\s+/g, "");
  for (const [i, ch] of [...body].entries()) {
    if (alphabet.indexOf(ch) === -1) return { ok: false, error: `Invalid character "${original[i] ?? ch}" at position ${i + 1} for this alphabet.` };
  }

  // Lengths mod 8 of 1, 3 and 6 can never come from whole bytes.
  if ([1, 3, 6].includes(body.length % 8)) {
    return { ok: false, error: `${body.length} Base32 characters is not a valid length (a trailing group of ${body.length % 8} cannot hold whole bytes).` };
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of body) {
    const value = alphabet.indexOf(ch);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  // Leftover bits must be zero in canonical Base32.
  if (buffer !== 0) return { ok: false, error: "The last character has non-zero padding bits, so this is not canonical Base32." };
  return { ok: true, bytes: Uint8Array.from(bytes) };
}

// ---------------------------------------------------------------------------------------------
// Base58
// ---------------------------------------------------------------------------------------------

export type Base58Alphabet = "bitcoin" | "flickr" | "ripple";

const BASE58_ALPHABETS: Record<Base58Alphabet, string> = {
  bitcoin: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  flickr: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
  ripple: "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz",
};

/** Base58 is quadratic; keep inputs to a size where it stays instant. */
export const BASE58_MAX_BYTES = 8192;

export function base58Encode(bytes: Uint8Array, alphabetName: Base58Alphabet): TextResult {
  if (bytes.length > BASE58_MAX_BYTES) return { ok: false, error: `Base58 is meant for short values; the limit here is ${BASE58_MAX_BYTES} bytes.` };
  const alphabet = BASE58_ALPHABETS[alphabetName];
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let digits = "";
  while (value > 0n) {
    digits = alphabet[Number(value % 58n)] + digits;
    value /= 58n;
  }
  return { ok: true, text: alphabet[0].repeat(zeros) + digits };
}

export function base58Decode(text: string, alphabetName: Base58Alphabet): BytesResult {
  const alphabet = BASE58_ALPHABETS[alphabetName];
  const clean = text.replace(/\s+/g, "");
  if (clean.length > BASE58_MAX_BYTES * 2) return { ok: false, error: "That is too long for Base58." };

  let zeros = 0;
  while (zeros < clean.length && clean[zeros] === alphabet[0]) zeros++;

  let value = 0n;
  for (const [i, ch] of [...clean].entries()) {
    const digit = alphabet.indexOf(ch);
    if (digit === -1) {
      const hint = /[0OIl]/.test(ch) ? " (Base58 leaves out 0, O, I and l because they look alike)" : "";
      return { ok: false, error: `Invalid character "${ch}" at position ${i + 1}${hint}.` };
    }
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  return { ok: true, bytes: Uint8Array.from([...Array<number>(zeros).fill(0), ...bytes]) };
}

// ---------------------------------------------------------------------------------------------
// Punycode (RFC 3492)
// ---------------------------------------------------------------------------------------------

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (((BASE - T_MIN) * T_MAX) >> 1)) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

const digitToChar = (d: number) => String.fromCharCode(d < 26 ? 97 + d : 22 + d); // a-z, then 0-9
const charToDigit = (c: string) => {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 22; // 0-9 -> 26-35
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
};

const threshold = (k: number, bias: number) => (k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias);

/** Raw Punycode of a string (no "xn--" prefix). */
export function punycodeEncode(input: string): string {
  const codePoints = Array.from(input, (ch) => ch.codePointAt(0)!);
  let output = codePoints.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join("");
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += "-";

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < codePoints.length) {
    const m = Math.min(...codePoints.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of codePoints) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = threshold(k, bias);
          if (q < t) break;
          output += digitToChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digitToChar(q);
        bias = adapt(delta, handled + 1, handled === basicLength);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

/** Raw Punycode to a string (no "xn--" prefix). */
export function punycodeDecode(input: string): TextResult {
  const lastDash = input.lastIndexOf("-");
  const basic = lastDash > 0 ? input.slice(0, lastDash) : "";
  for (const ch of basic) {
    if (ch.charCodeAt(0) >= 0x80) return { ok: false, error: "The part before the last hyphen must be plain ASCII." };
  }
  const output: number[] = Array.from(basic, (ch) => ch.charCodeAt(0));

  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  for (let index = lastDash > 0 ? lastDash + 1 : 0; index < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return { ok: false, error: "The Punycode ends in the middle of a number." };
      const digit = charToDigit(input[index++]);
      if (digit >= BASE) return { ok: false, error: `"${input[index - 1]}" is not a valid Punycode character.` };
      i += digit * w;
      if (!Number.isSafeInteger(i)) return { ok: false, error: "The Punycode number is too large." };
      const t = threshold(k, bias);
      if (digit < t) break;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return { ok: false, error: `The Punycode decodes to an invalid code point (U+${n.toString(16).toUpperCase()}).` };
    output.splice(i++, 0, n);
  }
  return { ok: true, text: String.fromCodePoint(...output) };
}

const LABEL_SEPARATORS = /[.。．｡]/;

export interface DomainResult {
  text: string;
  warnings: string[];
}

/** Domain name -> ASCII (xn--) form. Every label is lower-cased and NFC-normalized (a simplified IDNA mapping). */
export function domainToAscii(domain: string): DomainResult {
  const warnings: string[] = [];
  const labels = domain.split(LABEL_SEPARATORS).map((raw) => {
    const label = raw.normalize("NFC").toLowerCase();
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7f]*$/.test(label)) return label;
    const encoded = `xn--${punycodeEncode(label)}`;
    if (encoded.length > 63) warnings.push(`The label "${label}" becomes ${encoded.length} characters; a DNS label can be at most 63.`);
    return encoded;
  });
  const text = labels.join(".");
  if (text.length > 253) warnings.push(`The domain is ${text.length} characters; DNS allows at most 253.`);
  return { text, warnings };
}

/** Domain name from ASCII (xn--) form back to Unicode. Labels that are not valid Punycode are left as they are, with a warning. */
export function domainToUnicode(domain: string): DomainResult {
  const warnings: string[] = [];
  const text = domain
    .split(LABEL_SEPARATORS)
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      const decoded = punycodeDecode(label.slice(4).toLowerCase());
      if (!decoded.ok) {
        warnings.push(`"${label}": ${decoded.error}`);
        return label;
      }
      return decoded.text;
    })
    .join(".");
  return { text, warnings };
}
