/** Password generator (unbiased, crypto-random) and a heuristic strength estimator. */

/** Returns `n` cryptographically secure random bytes. Injectable so tests are deterministic. */
export type RandomBytes = (n: number) => Uint8Array;

export const secureRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 256;
export const MAX_COUNT = 100;

export const LOWER = "abcdefghijklmnopqrstuvwxyz";
export const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";
export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/~";
/** Characters that are easy to mix up when read aloud or in some fonts. */
export const AMBIGUOUS = "O0oIl1|";

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  /** Guarantee at least one character from every enabled set. */
  requireEach: boolean;
}

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  requireEach: true,
};

export function clampLength(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_OPTIONS.length;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(n)));
}

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_COUNT, Math.max(1, Math.round(n)));
}

/** Uniform integer in [0, max) using rejection sampling, so there is no modulo bias. */
export function randomInt(max: number, random: RandomBytes = secureRandom): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new RangeError("max must be an integer in 1..2^32");
  if (max === 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    const b = random(4);
    const v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (v < limit) return v % max;
  }
}

/** The character sets enabled by the options, after removing ambiguous characters. */
export function activeSets(o: PasswordOptions): string[] {
  const strip = (s: string) => (o.excludeAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join("") : s);
  const sets: string[] = [];
  if (o.lower) sets.push(strip(LOWER));
  if (o.upper) sets.push(strip(UPPER));
  if (o.digits) sets.push(strip(DIGITS));
  if (o.symbols) sets.push(strip(SYMBOLS));
  return sets;
}

export function validateOptions(o: PasswordOptions): string | null {
  if (!o.lower && !o.upper && !o.digits && !o.symbols) return "Enable at least one character set.";
  if (!Number.isInteger(o.length) || o.length < MIN_LENGTH || o.length > MAX_LENGTH) {
    return `Length must be between ${MIN_LENGTH} and ${MAX_LENGTH}.`;
  }
  if (o.requireEach && o.length < activeSets(o).length) {
    return `Length must be at least ${activeSets(o).length} to include every enabled set.`;
  }
  return null;
}

/** Entropy of a generated password in bits (exact when `requireEach` is off, a close upper bound otherwise). */
export function generatedEntropyBits(o: PasswordOptions): number {
  const pool = activeSets(o).join("").length;
  return pool === 0 ? 0 : o.length * Math.log2(pool);
}

export function generatePassword(o: PasswordOptions, random: RandomBytes = secureRandom): string {
  const error = validateOptions(o);
  if (error) throw new RangeError(error);
  const sets = activeSets(o);
  const pool = [...sets.join("")];
  const chars: string[] = [];
  if (o.requireEach) {
    for (const set of sets) chars.push(set[randomInt(set.length, random)]);
  }
  while (chars.length < o.length) chars.push(pool[randomInt(pool.length, random)]);
  // Fisher-Yates, so the guaranteed characters are not always at the start.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function generatePasswords(o: PasswordOptions, count: number, random: RandomBytes = secureRandom): string[] {
  return Array.from({ length: clampCount(count) }, () => generatePassword(o, random));
}

// ---------------------------------------------------------------- strength

export type StrengthLabel = "Very weak" | "Weak" | "Fair" | "Strong" | "Very strong";

export interface Strength {
  /** Estimated entropy in bits after penalties for repeats, sequences and common passwords. */
  bits: number;
  /** 0 (very weak) to 4 (very strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  length: number;
  /** Character classes found: lower, upper, digits, symbols, other. */
  classes: string[];
  warnings: string[];
  /** Time to guess by brute force against a fast offline attack, and a throttled online one. */
  crackTime: { offline: string; online: string };
}

/**
 * A few of the most common passwords. A real check would use a much bigger list; this catches the worst.
 * Leet-speak variants (p@ssw0rd) are not listed: `unleet` maps them back to the plain word before the lookup.
 */
const COMMON = new Set([
  "password", "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwerty123", "qwertyuiop", "abc123", "111111", "000000", "123123", "654321", "iloveyou", "admin",
  "administrator", "welcome", "login", "letmein", "monkey", "dragon", "master", "sunshine", "princess", "football",
  "baseball", "superman", "batman", "trustno1", "shadow", "michael", "freedom", "whatever", "hello", "secret",
  "default", "changeme", "guest", "root", "test", "test123", "user", "pass", "asdfgh", "zxcvbn", "indonesia",
  "rahasia", "sayang", "bismillah", "kucing", "jakarta", "bandung", "garuda", "merdeka",
]);

const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

function unleet(s: string): string {
  return [...s.toLowerCase()].map((c) => LEET[c] ?? c).join("");
}

function charClasses(pw: string): string[] {
  const out: string[] = [];
  if (/[a-z]/.test(pw)) out.push("lower");
  if (/[A-Z]/.test(pw)) out.push("upper");
  if (/[0-9]/.test(pw)) out.push("digits");
  if (/[ -/:-@[-`{-~]/.test(pw)) out.push("symbols");
  if (/[^\x20-\x7e]/.test(pw)) out.push("other");
  return out;
}

const POOL_SIZE: Record<string, number> = { lower: 26, upper: 26, digits: 10, symbols: 33, other: 100 };

/** True when `chars[i]` continues a run (abc, 321, qwe) started by the characters before it. */
function continuesPattern(chars: string[], i: number): boolean {
  if (i < 2) return false;
  const [a, b, c] = [chars[i - 2], chars[i - 1], chars[i]].map((x) => x.toLowerCase());
  const d1 = b.codePointAt(0)! - a.codePointAt(0)!;
  const d2 = c.codePointAt(0)! - b.codePointAt(0)!;
  if (d1 === d2 && Math.abs(d1) === 1) return true;
  const triple = a + b + c;
  return KEYBOARD_ROWS.some((row) => row.includes(triple) || [...row].reverse().join("").includes(triple));
}

function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds > 1e18) return "longer than the age of the universe";
  if (seconds < 1) return "instantly";
  const units: [string, number][] = [
    ["year", 365.25 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  if (seconds >= 365.25 * 86400 * 1e9) return "billions of years";
  if (seconds >= 365.25 * 86400 * 1e6) return "millions of years";
  if (seconds >= 365.25 * 86400 * 1e3) return "thousands of years";
  for (const [name, size] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n.toLocaleString("en-US")} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return "instantly";
}

/** Guesses per second assumed for the two attack models. */
export const OFFLINE_GUESSES_PER_SECOND = 1e10;
export const ONLINE_GUESSES_PER_SECOND = 10;

export function estimateStrength(password: string): Strength {
  const chars = [...password];
  const length = chars.length;
  const classes = charClasses(password);
  const warnings: string[] = [];

  if (length === 0) {
    return {
      bits: 0,
      score: 0,
      label: "Very weak",
      length: 0,
      classes: [],
      warnings: [],
      crackTime: { offline: "instantly", online: "instantly" },
    };
  }

  const pool = classes.reduce((sum, c) => sum + POOL_SIZE[c], 0);
  const perChar = Math.log2(pool);
  const seen = new Set<string>();
  let bits = 0;
  let repeats = 0;
  let runs = 0;
  chars.forEach((c, i) => {
    if (seen.has(c)) {
      repeats++;
      bits += 1;
    } else if (continuesPattern(chars, i)) {
      runs++;
      bits += 1;
    } else {
      bits += perChar;
    }
    seen.add(c);
  });

  // Dictionary check: drop leading/trailing digits and symbols (Password123!), then undo leet-speak (P@ssw0rd).
  const lowered = password.toLowerCase();
  const stripped = lowered.replace(/^[^a-z]+|[^a-z]+$/g, "");
  const isCommon =
    COMMON.has(lowered) || COMMON.has(unleet(password)) || (stripped.length >= 4 && (COMMON.has(stripped) || COMMON.has(unleet(stripped))));
  if (isCommon) {
    bits = Math.min(bits, Math.log2(COMMON.size) + 4);
    warnings.push("This is (or is based on) a very common password.");
  }

  if (length < 8) warnings.push("Shorter than 8 characters.");
  else if (length < 12) warnings.push("Shorter than 12 characters; aim for 14 or more.");
  if (classes.length === 1 && classes[0] === "digits") warnings.push("Digits only.");
  else if (classes.length === 1) warnings.push("Uses a single character type.");
  if (repeats >= Math.max(3, length / 3)) warnings.push("Many repeated characters.");
  if (runs >= 2) warnings.push("Contains sequences such as abc, 123 or qwerty.");

  bits = Math.max(0, bits);
  const score = (bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4) as Strength["score"];
  const labels: StrengthLabel[] = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];
  const guesses = 2 ** bits / 2;
  return {
    bits,
    score,
    label: labels[score],
    length,
    classes,
    warnings,
    crackTime: {
      offline: humanDuration(guesses / OFFLINE_GUESSES_PER_SECOND),
      online: humanDuration(guesses / ONLINE_GUESSES_PER_SECOND),
    },
  };
}
