import { describe, expect, it } from "vitest";
import { MAX_MATCHES, MAX_TEXT_LENGTH, captureGroupNames, highlightSegments, runRegex, validateFlags } from "./logic";

const run = (pattern: string, flags: string, text: string, replacement: string | null = null) => {
  const r = runRegex(pattern, flags, text, replacement);
  if (!r.ok) throw new Error(r.error);
  return r.outcome;
};
const fail = (pattern: string, flags: string, text = "x") => {
  const r = runRegex(pattern, flags, text);
  if (r.ok) throw new Error("expected error");
  return r.error;
};

describe("validateFlags", () => {
  it("accepts valid combinations", () => {
    for (const f of ["", "g", "gi", "gimsuy", "dgimsy", "v", "gv"]) expect(validateFlags(f)).toBeNull();
  });
  it("rejects unknown, duplicate and conflicting flags", () => {
    expect(validateFlags("x")).toBe('Unknown flag "x"');
    expect(validateFlags("gg")).toBe("Duplicate flag");
    expect(validateFlags("uv")).toMatch(/cannot be combined/);
  });
});

describe("captureGroupNames", () => {
  it.each([
    ["abc", []],
    ["(a)(b)", [null, null]],
    ["(?<year>\\d+)-(?<month>\\d+)", ["year", "month"]],
    ["(?:a)(b)", [null]],
    ["(?=a)(?!b)(?<=c)(?<!d)(e)", [null]],
    ["\\(a\\)(b)", [null]],
    ["[(]a(b)", [null]],
    ["[\\])]((x))", [null, null]],
    ["(a)(?<n>b)(c)", [null, "n", null]],
  ])("%s", (pattern, expected) => {
    expect(captureGroupNames(pattern)).toEqual(expected);
  });

  it("agrees with the engine's group count", () => {
    for (const p of ["(a)(?<n>b)(?:c)(d)", "((a)(b))", "[(]()", "\\((x)\\)"]) {
      expect(captureGroupNames(p)).toHaveLength(new RegExp(`${p}|`).exec("")!.length - 1);
    }
  });
});

describe("runRegex", () => {
  it("finds all matches with positions when global", () => {
    const { matches } = run("\\d+", "g", "a1 b22 c333");
    expect(matches.map((m) => [m.index, m.end, m.text])).toEqual([
      [1, 2, "1"],
      [4, 6, "22"],
      [8, 11, "333"],
    ]);
  });

  it("returns only the first match without g", () => {
    const { matches } = run("\\d+", "", "a1 b22");
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe("1");
  });

  it("returns no matches without error", () => {
    expect(run("z", "g", "abc").matches).toEqual([]);
  });

  it("reports numbered and named groups, including unmatched ones", () => {
    const { matches } = run("(?<year>\\d{4})-(\\d{2})(x)?", "", "on 2026-11 ok");
    expect(matches[0].groups).toEqual([
      { name: "year", number: 1, text: "2026" },
      { name: null, number: 2, text: "11" },
      { name: null, number: 3, text: undefined },
    ]);
  });

  it("honours flags", () => {
    expect(run("abc", "i", "xABCx").matches[0].text).toBe("ABC");
    expect(run("^b", "m", "a\nb").matches[0].index).toBe(2);
    expect(run("^b", "", "a\nb").matches).toEqual([]);
    expect(run("a.b", "s", "a\nb").matches).toHaveLength(1);
    expect(run("a.b", "", "a\nb").matches).toEqual([]);
    expect(run("\\p{L}+", "gu", "héllo wörld").matches.map((m) => m.text)).toEqual(["héllo", "wörld"]);
  });

  it("handles zero-length matches without looping forever", () => {
    const { matches } = run("x*", "g", "axb");
    expect(matches.map((m) => [m.index, m.text])).toEqual([[0, ""], [1, "x"], [2, ""], [3, ""]]);
  });

  it("is not affected by a sticky or stale lastIndex between runs", () => {
    expect(run("a", "gy", "aab").matches).toHaveLength(2);
    expect(run("a", "gy", "aab").matches).toHaveLength(2);
  });

  it("caps the number of matches", () => {
    const outcome = run("a", "g", "a".repeat(MAX_MATCHES + 50));
    expect(outcome.matches).toHaveLength(MAX_MATCHES);
    expect(outcome.truncated).toBe(true);
    expect(run("a", "g", "a".repeat(MAX_MATCHES)).truncated).toBe(false);
  });

  it("produces a replacement preview with $1 and $<name>", () => {
    expect(run("(\\w+)@(\\w+)", "g", "a@b c@d", "$2:$1").replaced).toBe("b:a d:c");
    expect(run("(?<n>\\d+)", "g", "a1b22", "[$<n>]").replaced).toBe("a[1]b[22]");
    expect(run("\\d", "", "1 2", "#").replaced).toBe("# 2"); // only first without g
    expect(run("\\d", "g", "1 2").replaced).toBeNull();
    expect(run("a", "g", "aa", "").replaced).toBe("");
  });

  it("explains errors", () => {
    expect(fail("", "g")).toBe("Enter a pattern");
    expect(fail("(", "g")).toMatch(/Unterminated group|Unmatched/i);
    expect(fail("[a", "")).toMatch(/Unterminated character class|missing/i);
    expect(fail("a", "gx")).toBe('Unknown flag "x"');
    expect(fail("a", "gg")).toBe("Duplicate flag");
    expect(fail("(?<n>a)(?<n>b)", "")).toMatch(/Duplicate capture group name/i);
    expect(fail("a", "g", "x".repeat(MAX_TEXT_LENGTH + 1))).toMatch(/too long/);
  });

  it("does not leak the engine prefix in messages", () => {
    expect(fail("(", "")).not.toMatch(/^Invalid regular expression/);
  });
});

describe("highlightSegments", () => {
  const segs = (pattern: string, flags: string, text: string) => highlightSegments(text, run(pattern, flags, text).matches);

  it("alternates plain and matched text covering the whole input", () => {
    const text = "a1 b22 c";
    const s = segs("\\d+", "g", text);
    expect(s).toEqual([
      { text: "a", match: null },
      { text: "1", match: 0 },
      { text: " b", match: null },
      { text: "22", match: 1 },
      { text: " c", match: null },
    ]);
    expect(s.map((x) => x.text).join("")).toBe(text);
  });

  it("handles matches at the edges and adjacent matches", () => {
    expect(segs("a", "g", "aa").map((s) => s.match)).toEqual([0, 1]);
    expect(segs("b", "g", "abc").map((s) => s.text)).toEqual(["a", "b", "c"]);
  });

  it("skips zero-length matches", () => {
    const s = segs("x*", "g", "axb");
    expect(s.map((x) => x.text).join("")).toBe("axb");
    expect(s.filter((x) => x.match !== null).map((x) => x.text)).toEqual(["x"]);
  });

  it("returns the text as one plain segment with no matches, and nothing for empty text", () => {
    expect(segs("z", "g", "abc")).toEqual([{ text: "abc", match: null }]);
    expect(highlightSegments("", [])).toEqual([]);
  });
});
