import { describe, expect, it } from "vitest";
import { collapseContext, diffText, splitLines, toUnifiedDiff, type DiffOptions, type Row } from "./logic";

const opts: DiffOptions = { ignoreWhitespace: false, ignoreCase: false, inline: "word" };

function diff(a: string, b: string, patch: Partial<DiffOptions> = {}) {
  const result = diffText(a, b, { ...opts, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result;
}

const kinds = (rows: Row[]) => rows.map((r) => r.kind);

describe("splitLines", () => {
  it("handles every newline style and trailing newlines", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a")).toEqual(["a"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb\rc")).toEqual(["a", "b", "c"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("diffText", () => {
  it("reports identical texts", () => {
    const { rows, stats } = diff("a\nb\n", "a\nb");
    expect(kinds(rows)).toEqual(["equal", "equal"]);
    expect(stats).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 2, identical: true });
    expect(diff("", "").stats.identical).toBe(true);
  });

  it("finds added, removed and changed lines with line numbers on both sides", () => {
    const { rows, stats } = diff("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(kinds(rows)).toEqual(["equal", "change", "equal", "equal", "add"]);
    expect(rows[1]).toMatchObject({ left: { no: 2, text: "b" }, right: { no: 2, text: "B" } });
    expect(rows[4]).toMatchObject({ right: { no: 5, text: "e" } });
    expect(stats).toEqual({ added: 2, removed: 1, changed: 1, unchanged: 3, identical: false });
  });

  it("pairs a block of removals with additions and leaves the surplus", () => {
    const { rows } = diff("x\n1\n2\n3\ny", "x\nA\nB\ny");
    expect(kinds(rows)).toEqual(["equal", "change", "change", "remove", "equal"]);
    expect(rows[3]).toMatchObject({ left: { no: 4, text: "3" } });
    const grown = diff("x\n1\ny", "x\nA\nB\nC\ny");
    expect(kinds(grown.rows)).toEqual(["equal", "change", "add", "add", "equal"]);
  });

  it("handles pure insertions and deletions", () => {
    expect(kinds(diff("", "a\nb").rows)).toEqual(["add", "add"]);
    expect(kinds(diff("a\nb", "").rows)).toEqual(["remove", "remove"]);
    expect(kinds(diff("a\nc", "a\nb\nc").rows)).toEqual(["equal", "add", "equal"]);
  });

  it("highlights words inside changed lines", () => {
    const { rows } = diff("the quick brown fox", "the slow brown fox");
    const row = rows[0];
    if (row.kind !== "change") throw new Error("expected a change row");
    expect(row.left.segments).toEqual([
      { text: "the ", changed: false },
      { text: "quick", changed: true },
      { text: " brown fox", changed: false },
    ]);
    expect(row.right.segments).toEqual([
      { text: "the ", changed: false },
      { text: "slow", changed: true },
      { text: " brown fox", changed: false },
    ]);
  });

  it("highlights characters, or nothing", () => {
    const chars = diff("cat", "cut", { inline: "char" }).rows[0];
    if (chars.kind !== "change") throw new Error("expected a change row");
    expect(chars.left.segments).toEqual([
      { text: "c", changed: false },
      { text: "a", changed: true },
      { text: "t", changed: false },
    ]);
    const none = diff("cat", "cut", { inline: "none" }).rows[0];
    if (none.kind !== "change") throw new Error("expected a change row");
    expect(none.left.segments).toBeUndefined();
  });

  it("can ignore whitespace and case", () => {
    expect(diff("a  b\n  c", "a b\nc", { ignoreWhitespace: true }).rows.map((r) => r.kind)).toEqual(["equal", "equal"]);
    expect(diff("Hello", "hello", { ignoreCase: true }).rows[0].kind).toBe("equal");
    expect(diff("Hello", "hello").rows[0].kind).toBe("change");
    // Lines that only differ in whitespace are not "identical" text, even though the diff shows no changes.
    const ws = diff("a  b", "a b", { ignoreWhitespace: true });
    expect(ws.stats.identical).toBe(false);
    expect(ws.stats.added + ws.stats.removed).toBe(0);
  });

  it("keeps the original text of equal rows on each side", () => {
    const row = diff("Hello", "hello", { ignoreCase: true }).rows[0];
    expect(row).toMatchObject({ kind: "equal", left: { text: "Hello" }, right: { text: "hello" } });
  });

  it("refuses absurdly large inputs", () => {
    const big = "x\n".repeat(50_001);
    const result = diffText(big, "", opts);
    expect(result.ok).toBe(false);
  });

  it("is fast enough for a few thousand lines", () => {
    const a = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[2500] = "changed";
    b.splice(100, 0, "inserted");
    const start = performance.now();
    const { stats } = diff(a.join("\n"), b.join("\n"));
    expect(performance.now() - start).toBeLessThan(2000);
    // one inserted line, plus one changed line (which counts once on each side)
    expect(stats).toMatchObject({ changed: 1, added: 2, removed: 1, unchanged: 4999 });
  });
});

describe("collapseContext", () => {
  const rows = diff(
    Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n"),
    Array.from({ length: 20 }, (_, i) => (i === 10 ? "CHANGED" : `l${i}`)).join("\n"),
  ).rows;

  it("keeps context around changes and counts what it hides", () => {
    const items = collapseContext(rows, 2);
    expect(items.map((i) => i.kind)).toEqual(["skip", "equal", "equal", "change", "equal", "equal", "skip"]);
    expect(items[0]).toEqual({ kind: "skip", count: 8 });
    expect(items[6]).toEqual({ kind: "skip", count: 7 });
  });

  it("keeps everything for infinite context and never hides a single row", () => {
    expect(collapseContext(rows, Infinity)).toHaveLength(20);
    // The change is row 10: rows 2..18 are in range, rows 0-1 are hidden (2 rows), and the single leftover row 19 is shown.
    const wide = collapseContext(rows, 8);
    expect(wide[0]).toEqual({ kind: "skip", count: 2 });
    expect(wide).toHaveLength(1 + 17 + 1);
    expect(wide[wide.length - 1].kind).toBe("equal");
  });

  it("returns a single skip for identical texts", () => {
    const same = diff("a\nb\nc\nd", "a\nb\nc\nd").rows;
    expect(collapseContext(same, 1)).toEqual([{ kind: "skip", count: 4 }]);
  });
});

describe("toUnifiedDiff", () => {
  it("writes hunks with headers and context", () => {
    const rows = diff("a\nb\nc\nd\ne\nf\ng\nh", "a\nb\nc\nX\ne\nf\ng\nh").rows;
    expect(toUnifiedDiff(rows, { context: 2 })).toBe(
      "--- original\n+++ modified\n@@ -2,5 +2,5 @@\n b\n c\n-d\n+X\n e\n f\n",
    );
  });

  it("groups removals before additions and merges close hunks", () => {
    const rows = diff("1\n2\n3\n4\n5\n6\n7\n8\n9", "1\nA\nB\n4\n5\n6\n7\n8\nZ").rows;
    expect(toUnifiedDiff(rows, { context: 1, fromName: "a.txt", toName: "b.txt" })).toBe(
      "--- a.txt\n+++ b.txt\n@@ -1,4 +1,4 @@\n 1\n-2\n-3\n+A\n+B\n 4\n@@ -8,2 +8,2 @@\n 8\n-9\n+Z\n",
    );
    expect(toUnifiedDiff(rows, { context: 3 })).toContain("@@ -1,9 +1,9 @@");
  });

  it("handles additions to an empty file and deletions of everything", () => {
    expect(toUnifiedDiff(diff("", "a\nb").rows)).toBe("--- original\n+++ modified\n@@ -0,0 +1,2 @@\n+a\n+b\n");
    expect(toUnifiedDiff(diff("a\nb", "").rows)).toBe("--- original\n+++ modified\n@@ -1,2 +0,0 @@\n-a\n-b\n");
  });

  it("is empty when nothing differs", () => {
    expect(toUnifiedDiff(diff("a", "a").rows)).toBe("");
  });
});
