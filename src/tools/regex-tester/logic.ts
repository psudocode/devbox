/** Regex tester logic: pure and synchronous. The UI runs it in a worker with a timeout (see executor.ts). */

export const MAX_MATCHES = 1000;
export const MAX_TEXT_LENGTH = 1_000_000;

export const FLAG_INFO = [
  { flag: "g", name: "global", hint: "Find all matches, not just the first" },
  { flag: "i", name: "ignore case", hint: "Case-insensitive" },
  { flag: "m", name: "multiline", hint: "^ and $ match at line breaks" },
  { flag: "s", name: "dotAll", hint: ". also matches line breaks" },
  { flag: "u", name: "unicode", hint: "Full Unicode mode (code points, \\p{...})" },
  { flag: "y", name: "sticky", hint: "Match only at lastIndex (no scanning forward)" },
] as const;

const VALID_FLAGS = "dgimsuvy";

export function validateFlags(flags: string): string | null {
  for (const ch of flags) {
    if (!VALID_FLAGS.includes(ch)) return `Unknown flag "${ch}"`;
  }
  if (new Set(flags).size !== flags.length) return "Duplicate flag";
  if (flags.includes("u") && flags.includes("v")) return 'Flags "u" and "v" cannot be combined';
  return null;
}

export interface GroupInfo {
  /** Group name, or null for an unnamed group. */
  name: string | null;
  /** 1-based group number. */
  number: number;
  /** Captured text; undefined if the group did not take part in the match. */
  text: string | undefined;
}

export interface MatchInfo {
  index: number;
  end: number;
  text: string;
  groups: GroupInfo[];
}

export interface RegexOutcome {
  matches: MatchInfo[];
  /** True if more than MAX_MATCHES matches exist. */
  truncated: boolean;
  /** Result of String.replace with the replacement template, when one was given. */
  replaced: string | null;
}

export type RegexResult = { ok: true; outcome: RegexOutcome } | { ok: false; error: string };

/**
 * Names of the capture groups of a pattern, in order (null = unnamed).
 * A light scanner: skips escapes and character classes, ignores (?: (?= (?! (?<= (?<! which do not capture.
 */
export function captureGroupNames(pattern: string): (string | null)[] {
  const names: (string | null)[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
    } else if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "(") {
      if (pattern[i + 1] !== "?") {
        names.push(null);
      } else {
        const named = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(pattern.slice(i, i + 80));
        if (named) names.push(named[1]);
      }
    }
  }
  return names;
}

export function runRegex(pattern: string, flags: string, text: string, replacement: string | null = null): RegexResult {
  const flagError = validateFlags(flags);
  if (flagError) return { ok: false, error: flagError };
  if (pattern === "") return { ok: false, error: "Enter a pattern" };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: `Text is too long (max ${MAX_TEXT_LENGTH.toLocaleString("en-US")} characters)` };

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Invalid pattern" };
  }

  const names = captureGroupNames(pattern);
  const matches: MatchInfo[] = [];
  let truncated = false;

  const toInfo = (m: RegExpMatchArray): MatchInfo => ({
    index: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    text: m[0],
    groups: m.slice(1).map((value, i) => ({ name: names[i] ?? null, number: i + 1, text: value })),
  });

  if (flags.includes("g")) {
    // matchAll needs a global regex and clones it, so lastIndex of ours is untouched.
    for (const m of text.matchAll(regex)) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      matches.push(toInfo(m));
    }
  } else {
    const m = regex.exec(text);
    if (m) matches.push(toInfo(m));
  }

  let replaced: string | null = null;
  if (replacement !== null) {
    try {
      replaced = text.replace(new RegExp(pattern, flags), replacement);
    } catch {
      replaced = null;
    }
  }

  return { ok: true, outcome: { matches, truncated, replaced } };
}

export interface Segment {
  text: string;
  /** Index into the matches array when this segment is (part of) a match. */
  match: number | null;
}

/** Split `text` into alternating plain / matched segments for highlighting. Zero-length matches produce no segment. */
export function highlightSegments(text: string, matches: readonly MatchInfo[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.end === m.index || m.index < cursor) return; // empty or overlapping (sticky/odd cases)
    if (m.index > cursor) segments.push({ text: text.slice(cursor, m.index), match: null });
    segments.push({ text: text.slice(m.index, m.end), match: i });
    cursor = m.end;
  });
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: null });
  return segments;
}
