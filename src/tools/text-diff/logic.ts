import { diffArrays, diffChars, diffWordsWithSpace } from "diff";

export interface DiffOptions {
  /** Compare lines after trimming and collapsing whitespace. */
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  /** How to highlight what changed inside a modified line. */
  inline: "word" | "char" | "none";
}

export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  /** 1-based line number on its own side. */
  no: number;
  text: string;
  /** Present on modified lines when inline highlighting is on. */
  segments?: Segment[];
}

export type Row =
  | { kind: "equal"; left: DiffLine; right: DiffLine }
  | { kind: "change"; left: DiffLine; right: DiffLine }
  | { kind: "remove"; left: DiffLine }
  | { kind: "add"; right: DiffLine };

export interface DiffStats {
  /** Lines only in the modified text (including the new side of changed lines). */
  added: number;
  /** Lines only in the original text (including the old side of changed lines). */
  removed: number;
  /** Rows where an original line was replaced by a modified line. */
  changed: number;
  unchanged: number;
  identical: boolean;
}

export type DiffResult = { ok: true; rows: Row[]; stats: DiffStats } | { ok: false; error: string };

export const MAX_LINES = 50_000;
const TIMEOUT_MS = 4000;

/** Split into lines, accepting LF, CRLF and CR. A trailing newline does not create an extra empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function inlineSegments(left: string, right: string, mode: "word" | "char"): { left: Segment[]; right: Segment[] } {
  const parts = mode === "word" ? diffWordsWithSpace(left, right) : diffChars(left, right);
  const l: Segment[] = [];
  const r: Segment[] = [];
  for (const part of parts) {
    if (!part.added) l.push({ text: part.value, changed: part.removed });
    if (!part.removed) r.push({ text: part.value, changed: part.added });
  }
  return { left: l, right: r };
}

/** Line diff of two texts, with removed/added lines paired up into "change" rows. */
export function diffText(original: string, modified: string, options: DiffOptions): DiffResult {
  const a = splitLines(original);
  const b = splitLines(modified);
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { ok: false, error: `Each text can have at most ${MAX_LINES.toLocaleString("en-US")} lines for a live diff.` };
  }

  const normalize = (line: string) => {
    let s = line;
    if (options.ignoreWhitespace) s = s.trim().replace(/\s+/g, " ");
    if (options.ignoreCase) s = s.toLowerCase();
    return s;
  };
  const parts = diffArrays(a, b, { comparator: (x, y) => normalize(x) === normalize(y), timeout: TIMEOUT_MS });
  if (!parts) return { ok: false, error: "These texts are too different to compare quickly. Try smaller pieces." };

  const rows: Row[] = [];
  const stats: DiffStats = { added: 0, removed: 0, changed: 0, unchanged: 0, identical: true };
  let ai = 0;
  let bi = 0;
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];

  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let i = 0; i < paired; i++) {
      const left = removed[i];
      const right = added[i];
      if (options.inline !== "none") {
        const segs = inlineSegments(left.text, right.text, options.inline);
        left.segments = segs.left;
        right.segments = segs.right;
      }
      rows.push({ kind: "change", left, right });
    }
    for (const left of removed.slice(paired)) rows.push({ kind: "remove", left });
    for (const right of added.slice(paired)) rows.push({ kind: "add", right });
    stats.changed += paired;
    stats.removed += removed.length;
    stats.added += added.length;
    if (removed.length + added.length > 0) stats.identical = false;
    removed = [];
    added = [];
  };

  for (const part of parts) {
    if (part.removed) {
      for (let i = 0; i < part.count; i++, ai++) removed.push({ no: ai + 1, text: a[ai] });
    } else if (part.added) {
      for (let i = 0; i < part.count; i++, bi++) added.push({ no: bi + 1, text: b[bi] });
    } else {
      flush();
      for (let i = 0; i < part.count; i++, ai++, bi++) {
        rows.push({ kind: "equal", left: { no: ai + 1, text: a[ai] }, right: { no: bi + 1, text: b[bi] } });
        stats.unchanged++;
        // Equal after normalizing, but the text itself may still differ (whitespace / case).
        if (a[ai] !== b[bi]) stats.identical = false;
      }
    }
  }
  flush();
  return { ok: true, rows, stats };
}

export type DisplayItem = Row | { kind: "skip"; count: number };

/** Hide long runs of unchanged rows, keeping `context` rows around every change. Infinity keeps everything. */
export function collapseContext(rows: Row[], context: number): DisplayItem[] {
  if (!Number.isFinite(context)) return rows;
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.kind === "equal") return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true;
  });
  const out: DisplayItem[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i++]);
      continue;
    }
    let j = i;
    while (j < rows.length && !keep[j]) j++;
    // Hiding a single row saves nothing; show it.
    if (j - i === 1) out.push(rows[i]);
    else out.push({ kind: "skip", count: j - i });
    i = j;
  }
  return out;
}

/** Standard unified diff text (`diff -u` style) built from the rows. Returns "" when nothing differs. */
export function toUnifiedDiff(
  rows: Row[],
  { context = 3, fromName = "original", toName = "modified" }: { context?: number; fromName?: string; toName?: string } = {},
): string {
  // Number of old/new lines consumed before each row.
  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let o = 0;
  let n = 0;
  for (const row of rows) {
    oldBefore.push(o);
    newBefore.push(n);
    if (row.kind !== "add") o++;
    if (row.kind !== "remove") n++;
  }

  const changed = rows.map((r, i) => (r.kind === "equal" ? -1 : i)).filter((i) => i >= 0);
  if (changed.length === 0) return "";

  // Merge change positions into hunks, joining those whose context windows touch.
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const start = Math.max(0, i - context);
    const end = Math.min(rows.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const out: string[] = [`--- ${fromName}`, `+++ ${toName}`];
  for (const [start, end] of hunks) {
    const body: string[] = [];
    let minus: string[] = [];
    let plus: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    const flush = () => {
      body.push(...minus, ...plus);
      minus = [];
      plus = [];
    };
    for (let i = start; i <= end; i++) {
      const row = rows[i];
      if (row.kind === "equal") {
        flush();
        body.push(` ${row.left.text}`);
        oldCount++;
        newCount++;
      } else {
        if (row.kind !== "add") {
          minus.push(`-${row.left.text}`);
          oldCount++;
        }
        if (row.kind !== "remove") {
          plus.push(`+${row.right.text}`);
          newCount++;
        }
      }
    }
    flush();
    const oldStart = oldCount === 0 ? oldBefore[start] : oldBefore[start] + 1;
    const newStart = newCount === 0 ? newBefore[start] : newBefore[start] + 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
  }
  return `${out.join("\n")}\n`;
}
