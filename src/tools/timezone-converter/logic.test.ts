import { describe, expect, it } from "vitest";
import { convertTimeZone, formatDiffLabel } from "./logic";

describe("formatDiffLabel", () => {
  it("formats zero, positive, and negative minute differences", () => {
    expect(formatDiffLabel(0)).toBe("same");
    expect(formatDiffLabel(420)).toBe("+07:00");
    expect(formatDiffLabel(-300)).toBe("-05:00");
    expect(formatDiffLabel(330)).toBe("+05:30");
  });
});

describe("convertTimeZone", () => {
  it("converts wall-clock time from Asia/Jakarta to UTC, Tokyo, and New York", () => {
    const res = convertTimeZone("2026-11-27 01:30:00", "Asia/Jakarta", ["UTC", "Asia/Tokyo", "America/New_York"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.usedOffset).toBe("zone");
    expect(res.source.view.zonedText).toBe("2026-11-27 01:30:00.000");

    const utc = res.targets.find((t) => t.timeZone === "UTC")!;
    expect(utc.view.zonedText).toBe("2026-11-26 18:30:00.000");
    expect(utc.diffLabel).toBe("-07:00");
    expect(utc.dayShift).toBe(-1);

    const tokyo = res.targets.find((t) => t.timeZone === "Asia/Tokyo")!;
    expect(tokyo.view.zonedText).toBe("2026-11-27 03:30:00.000");
    expect(tokyo.diffLabel).toBe("+02:00");
    expect(tokyo.dayShift).toBe(0);

    const ny = res.targets.find((t) => t.timeZone === "America/New_York")!;
    expect(ny.view.zonedText).toBe("2026-11-26 13:30:00.000");
    expect(ny.diffLabel).toBe("-12:00");
    expect(ny.dayShift).toBe(-1);
  });

  it("respects explicit UTC offset in input", () => {
    const res = convertTimeZone("2026-11-26T18:00:00Z", "America/New_York", ["Asia/Jakarta"]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.usedOffset).toBe("explicit");
    expect(res.targets[0].view.zonedText).toBe("2026-11-27 01:00:00.000");
  });

  it("handles DST differences in America/New_York (EDT vs EST)", () => {
    const summer = convertTimeZone("2026-07-01 12:00:00", "UTC", ["America/New_York"]);
    const winter = convertTimeZone("2026-01-15 12:00:00", "UTC", ["America/New_York"]);
    expect(summer.ok && winter.ok).toBe(true);
    if (!summer.ok || !winter.ok) return;
    expect(summer.targets[0].diffLabel).toBe("-04:00");
    expect(winter.targets[0].diffLabel).toBe("-05:00");
  });

  it("deduplicates target zones and rejects invalid zone or date", () => {
    const dup = convertTimeZone("2026-11-27 00:00:00", "UTC", ["UTC", "UTC"]);
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.targets).toHaveLength(1);

    const badZone = convertTimeZone("2026-11-27 00:00:00", "UTC", ["Mars/Olympus"]);
    expect(badZone.ok).toBe(false);

    const empty = convertTimeZone("  ", "UTC", ["Asia/Jakarta"]);
    expect(empty.ok).toBe(false);
  });
});
