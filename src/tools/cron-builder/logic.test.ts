import { describe, expect, it } from "vitest";
import { explainCron, nextCronRuns, parseCron } from "./logic";

describe("parseCron", () => {
  it("parses standard 5-field expressions, ranges, steps, lists, and names", () => {
    const res = parseCron("*/15 9-17 1,15 JAN-MAR MON-FRI");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cron.fields[0].values).toEqual([0, 15, 30, 45]);
    expect(res.cron.fields[1].values).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(res.cron.fields[2].values).toEqual([1, 15]);
    expect(res.cron.fields[3].values).toEqual([1, 2, 3]);
    expect(res.cron.fields[4].values).toEqual([1, 2, 3, 4, 5]);
  });

  it("maps weekday 7 to Sunday (0) and supports @macros", () => {
    const sun = parseCron("0 0 * * 7");
    expect(sun.ok).toBe(true);
    if (sun.ok) expect(sun.cron.fields[4].values).toEqual([0]);

    const daily = parseCron("@daily");
    expect(daily.ok).toBe(true);
    if (daily.ok) expect(daily.cron.normalized).toBe("0 0 * * *");
  });

  it("rejects invalid field counts, out-of-range values, and bad steps", () => {
    expect(parseCron("* * *").ok).toBe(false);
    expect(parseCron("60 * * * *").ok).toBe(false);
    expect(parseCron("0 24 * * *").ok).toBe(false);
    expect(parseCron("0 0 0 * *").ok).toBe(false);
    expect(parseCron("*/0 * * * *").ok).toBe(false);
    expect(parseCron("5-2 * * * *").ok).toBe(false);
  });
});

describe("explainCron", () => {
  it("produces human-readable summaries", () => {
    const a = explainCron("*/5 * * * *");
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.summary).toBe("Every 5 minutes");

    const b = explainCron("30 9 * * 1-5");
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.summary).toBe("At 09:30 on Monday through Friday");

    const c = explainCron("0 0 1 1 *");
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.summary).toBe("At 00:00 on day 1 of the month in Jan");
  });
});

describe("nextCronRuns", () => {
  it("computes next N runs in UTC and Asia/Jakarta", () => {
    const from = Date.UTC(2026, 10, 26, 18, 0, 0); // 2026-11-26 18:00 UTC = 2026-11-27 01:00 WIB
    const utcRuns = nextCronRuns("0 1 * * *", 3, from, "Asia/Jakarta");
    expect(utcRuns.ok).toBe(true);
    if (!utcRuns.ok) return;
    expect(utcRuns.runs.map((r) => r.zonedText.slice(0, 19))).toEqual([
      "2026-11-28 01:00:00",
      "2026-11-29 01:00:00",
      "2026-11-30 01:00:00",
    ]);
  });

  it("uses OR semantics when both DOM and DOW are restricted", () => {
    const from = Date.UTC(2026, 10, 26, 0, 0, 0); // Thu Nov 26
    const res = nextCronRuns("0 0 28 * 5", 2, from, "UTC"); // Fri Nov 27 (DOW=5) and Nov 28 (DOM=28)
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.runs.map((r) => r.zonedText.slice(0, 10))).toEqual(["2026-11-27", "2026-11-28"]);
  });

  it("fails gracefully for impossible calendar dates like Feb 30", () => {
    const res = nextCronRuns("0 0 30 2 *", 3, Date.UTC(2026, 0, 1), "UTC");
    expect(res.ok).toBe(false);
  });
});
