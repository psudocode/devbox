/** Integer base conversion (bases 2-36) on BigInt: no precision limit. Fractions are not supported. */

export const MIN_BASE = 2;
export const MAX_BASE = 36;
export const MAX_INPUT_LENGTH = 20000;

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

export const isValidBase = (base: number) => Number.isInteger(base) && base >= MIN_BASE && base <= MAX_BASE;

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

const PREFIXES: Record<number, string> = { 2: "0b", 8: "0o", 16: "0x" };

/**
 * Parse an integer written in `base`.
 * Accepts a leading "-" or "+", the matching 0b / 0o / 0x prefix (only for bases 2, 8, 16),
 * upper or lower case digits, and "_", "," or whitespace as digit separators.
 */
export function parseInteger(text: string, base: number): ParseResult {
  if (!isValidBase(base)) return { ok: false, error: `Base must be a whole number from ${MIN_BASE} to ${MAX_BASE}` };
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, error: `Input is too long (max ${MAX_INPUT_LENGTH} characters)` };

  let rest = text.replace(/[\s_,]/g, "").toLowerCase();
  let negative = false;
  if (rest.startsWith("-") || rest.startsWith("+")) {
    negative = rest[0] === "-";
    rest = rest.slice(1);
  }
  const prefix = PREFIXES[base];
  if (prefix && rest.startsWith(prefix)) rest = rest.slice(2);
  if (rest === "") return { ok: false, error: "Enter a number" };

  const bigBase = BigInt(base);
  let value = 0n;
  for (let i = 0; i < rest.length; i++) {
    const digit = DIGITS.indexOf(rest[i]);
    if (digit === -1 || digit >= base) {
      const hint = rest[i] === "." ? " (only integers are supported)" : "";
      return { ok: false, error: `"${rest[i]}" is not a valid digit in base ${base}${hint}` };
    }
    value = value * bigBase + BigInt(digit);
  }
  return { ok: true, value: negative ? -value : value };
}

export interface FormatOptions {
  uppercase?: boolean;
  /** Insert `separator` every `group` digits, counted from the right. 0 / undefined = no grouping. */
  group?: number;
  separator?: string;
}

/** Insert a separator every `size` characters counted from the right. */
export function groupDigits(digits: string, size: number, separator: string): string {
  if (!(size > 0) || digits.length <= size) return digits;
  const parts: string[] = [];
  for (let end = digits.length; end > 0; end -= size) parts.unshift(digits.slice(Math.max(0, end - size), end));
  return parts.join(separator);
}

export function formatInteger(value: bigint, base: number, options: FormatOptions = {}): string {
  if (!isValidBase(base)) throw new RangeError(`Invalid base ${base}`);
  const negative = value < 0n;
  let digits = (negative ? -value : value).toString(base);
  if (options.uppercase) digits = digits.toUpperCase();
  if (options.group) digits = groupDigits(digits, options.group, options.separator ?? " ");
  return negative ? `-${digits}` : digits;
}

export const COMMON_BASES = [
  { base: 2, label: "Binary (2)", group: 4, separator: " " },
  { base: 8, label: "Octal (8)", group: 3, separator: " " },
  { base: 10, label: "Decimal (10)", group: 3, separator: "," },
  { base: 16, label: "Hexadecimal (16)", group: 4, separator: " " },
] as const;
