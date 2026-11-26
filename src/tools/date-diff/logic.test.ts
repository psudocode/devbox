import { describe, expect, it } from "vitest";
import { addIsoDuration, diffDates, parseIsoDuration } from "./logic";

describe("diffDates", () => {
  it("computes calendar breakdown, ISO duration, and day counts", () => {
    const res = diffDates("2025-01-15 09:00:00", "2026-03-18 11:30:15", "UTC");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.diff.direction).toBe("forward");
    expect(res.diff.breakdown).toEqual({
      years: 1,
      months: 2,
      days: 3,
      hours: 2,
      minutes: 30,
      seconds: 15,
      milliseconds: 0,
    });
    expect(res.diff.isoDuration).toBe("P1Y2M3DT2H30M15S");
    expect(res.diff.humanReadable).toBe("1 year, 2 months, 3 days, 2 hours, 30 minutes, 15 seconds");
  });

  it("handles backward differences and equal dates", () => {
    const back = diffDates("2026-11-27 12:00:00", "2026-11-25 12:00:00", "Asia/Jakarta");
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.diff.direction).toBe("backward");
      expect(back.diff.isoDuration).toBe("-P2D");
      expect(back.diff.totalDays).toBe(2);
    }

    const same = diffDates("2026-11-27 00:00:00", "2026-11-27 00:00:00", "UTC");
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.diff.direction).toBe("same");
      expect(same.diff.isoDuration).toBe("PT0S");
    }
  });

  it("counts weekdays and weekend days accurately", () => {
    // Mon 2026-11-23 to Mon 2026-11-30 = 7 days: 5 weekdays, 2 weekend days
    const res = diffDates("2026-11-23 00:00:00", "2026-11-30 00:00:00", "UTC");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.diff.weekdays).toBe(5);
    expect(res.diff.weekendDays).toBe(2);
  });
});

describe("parseIsoDuration & addIsoDuration", () => {
  it("parses ISO 8601 durations including weeks and negative sign", () => {
    const p = parseIsoDuration("-P2W3DT4H");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.duration).toEqual({
      sign: -1,
      years: 0,
      months: 0,
      weeks: 2,
      days: 3,
      hours: 4,
      minutes: 0,
      seconds: 0,
    });
  });

  it("adds and subtracts ISO durations with month-end clamping", () => {
    const added = addIsoDuration("2026-01-31 10:00:00", "P1M", "UTC");
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.view.zonedText.slice(0, 19)).toBe("2026-02-28 10:00:00");

    const sub = addIsoDuration("2026-11-27 09:00:00", "P1DT2H", "Asia/Jakarta", true);
    expect(sub.ok).toBe(true);
    if (sub.ok) expect(sub.view.zonedText.slice(0, 19)).toBe("2026-11-26 07:00:00");
  });

  it("rejects invalid ISO duration strings", () => {
    expect(parseIsoDuration("P").ok).toBe(false);
    expect(parseIsoDuration("PT").ok).toBe(false);
    expect(parseIsoDuration("2 days").ok).toBe(false);
  });
});
