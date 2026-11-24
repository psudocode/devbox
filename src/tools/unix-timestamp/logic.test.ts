import { describe, expect, it } from "vitest";
import {
  dateToTimestamp,
  describeInstant,
  detectUnit,
  formatOffset,
  isValidTimeZone,
  offsetMinutes,
  timestampToDate,
} from "./logic";

const view = (ts: number, tz: string) => describeInstant(ts * 1000, tz);

describe("detectUnit", () => {
  it.each([
    [0, "s"],
    [1700000000, "s"],
    [99999999999, "s"],
    [1700000000000, "ms"],
    [99999999999999, "ms"],
    [1700000000000000, "us"],
    [1700000000000000000, "ns"],
    [-1700000000, "s"],
    [-1700000000000, "ms"],
  ])("%d -> %s", (value, unit) => {
    expect(detectUnit(value)).toBe(unit);
  });
});

describe("offsets", () => {
  it("formats offsets", () => {
    expect(formatOffset(420)).toBe("+07:00");
    expect(formatOffset(-300)).toBe("-05:00");
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(-570)).toBe("-09:30");
  });

  it("knows offsets, including DST and half-hour zones (reference: Python zoneinfo)", () => {
    expect(offsetMinutes(1700000000000, "Asia/Jakarta")).toBe(420);
    expect(offsetMinutes(1700000000000, "America/New_York")).toBe(-300); // EST
    expect(offsetMinutes(1720000000000, "America/New_York")).toBe(-240); // EDT
    expect(offsetMinutes(1700000000000, "Asia/Kolkata")).toBe(330);
    expect(offsetMinutes(1720000000000, "Australia/Lord_Howe")).toBe(630); // +10:30
    expect(offsetMinutes(1700000000000, "Australia/Lord_Howe")).toBe(660); // +11:00 DST
    expect(offsetMinutes(1700000000000, "UTC")).toBe(0);
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("describeInstant", () => {
  it("renders the same instant in different zones", () => {
    const utc = view(1700000000, "UTC");
    expect(utc.utcIso).toBe("2023-11-14T22:13:20.000Z");
    expect(utc.zonedText).toBe("2023-11-14 22:13:20.000");
    expect(utc.weekday).toBe("Tuesday");

    const jakarta = view(1700000000, "Asia/Jakarta");
    expect(jakarta.zonedText).toBe("2023-11-15 05:13:20.000");
    expect(jakarta.zonedIso).toBe("2023-11-15T05:13:20.000+07:00");
    expect(jakarta.weekday).toBe("Wednesday");
    expect(jakarta.zoneName).toMatch(/GMT\+7|WIB/);

    expect(view(1700000000, "America/New_York").zonedIso).toBe("2023-11-14T17:13:20.000-05:00");
    expect(view(1720000000, "America/New_York").zonedIso).toBe("2024-07-03T05:46:40.000-04:00");
    expect(view(1700000000, "Asia/Kolkata").zonedIso).toBe("2023-11-15T03:43:20.000+05:30");
    expect(view(1720000000, "Australia/Lord_Howe").zonedIso).toBe("2024-07-03T20:16:40.000+10:30");
  });

  it("handles the epoch, negative times and leap days", () => {
    expect(view(0, "UTC").utcIso).toBe("1970-01-01T00:00:00.000Z");
    expect(view(-1, "UTC").utcIso).toBe("1969-12-31T23:59:59.000Z");
    expect(view(-1, "America/New_York").zonedText).toBe("1969-12-31 18:59:59.000");
    expect(view(951782400, "UTC").zonedText).toBe("2000-02-29 00:00:00.000");
  });

  it("keeps milliseconds, also for negative instants", () => {
    expect(describeInstant(1700000000123, "UTC").zonedText).toBe("2023-11-14 22:13:20.123");
    expect(describeInstant(-1, "UTC").zonedText).toBe("1969-12-31 23:59:59.999");
    expect(describeInstant(-1, "UTC").seconds).toBe(-1);
  });

  it("handles DST boundaries (reference: Python zoneinfo)", () => {
    expect(view(1711846800, "Europe/London").zonedText).toBe("2024-03-31 02:00:00.000"); // just after spring forward
    expect(view(1730613600, "America/New_York").zonedIso).toBe("2024-11-03T01:00:00.000-05:00"); // second 01:00
  });
});

describe("timestampToDate", () => {
  const ok = (input: string, unit: Parameters<typeof timestampToDate>[1], tz = "UTC") => {
    const r = timestampToDate(input, unit, tz);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("auto-detects seconds and milliseconds", () => {
    const s = ok("1700000000", "auto");
    expect(s.unit).toBe("s");
    expect(s.detected).toBe(true);
    expect(s.view.utcIso).toBe("2023-11-14T22:13:20.000Z");
    const ms = ok("1700000000123", "auto");
    expect(ms.unit).toBe("ms");
    expect(ms.view.utcIso).toBe("2023-11-14T22:13:20.123Z");
  });

  it("supports microseconds, nanoseconds and explicit units", () => {
    expect(ok("1700000000123456", "auto").unit).toBe("us");
    expect(ok("1700000000123456", "auto").view.utcIso).toBe("2023-11-14T22:13:20.123Z");
    expect(ok("1700000000123456789", "auto").unit).toBe("ns");
    expect(ok("1700000000", "ms").view.utcIso).toBe("1970-01-20T16:13:20.000Z");
    expect(ok("1700000000", "ms").detected).toBe(false);
  });

  it("accepts decimals, signs, separators and surrounding whitespace", () => {
    expect(ok("1700000000.5", "s").view.utcIso).toBe("2023-11-14T22:13:20.500Z");
    expect(ok("-1", "auto").view.utcIso).toBe("1969-12-31T23:59:59.000Z");
    expect(ok(" 1_700_000_000 ", "auto").view.seconds).toBe(1700000000);
    expect(ok("+0", "auto").view.utcIso).toBe("1970-01-01T00:00:00.000Z");
  });

  it("applies the time zone", () => {
    expect(ok("1700000000", "auto", "Asia/Jakarta").view.zonedIso).toBe("2023-11-15T05:13:20.000+07:00");
  });

  it("rejects bad input", () => {
    const err = (input: string, unit: Parameters<typeof timestampToDate>[1] = "auto", tz = "UTC") => {
      const r = timestampToDate(input, unit, tz);
      if (r.ok) throw new Error("expected error");
      return r.error;
    };
    expect(err("")).toBe("Enter a timestamp");
    expect(err("abc")).toMatch(/is a number/);
    expect(err("1e9")).toMatch(/is a number/);
    expect(err("12.")).toMatch(/is a number/);
    expect(err("1700000000", "auto", "Nope/Zone")).toMatch(/Unknown time zone/);
    expect(err("99999999999999999999", "s")).toMatch(/outside the supported date range/);
  });
});

describe("dateToTimestamp", () => {
  const ok = (input: string, tz = "UTC") => {
    const r = dateToTimestamp(input, tz);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const err = (input: string, tz = "UTC") => {
    const r = dateToTimestamp(input, tz);
    if (r.ok) throw new Error("expected error");
    return r.error;
  };

  it("reads wall-clock time in the chosen zone (reference: Python zoneinfo)", () => {
    expect(ok("2024-07-01 12:00:00", "Asia/Jakarta").ms / 1000).toBe(1719810000);
    expect(ok("2024-07-01 12:00:00", "Asia/Kolkata").ms / 1000).toBe(1719815400);
    expect(ok("2024-07-01 12:00:00", "America/New_York").ms / 1000).toBe(1719849600);
    expect(ok("2024-07-01 12:00:00", "UTC").usedOffset).toBe("zone");
  });

  it("honours an explicit offset or Z over the selected zone", () => {
    expect(ok("2023-11-14T22:13:20Z", "Asia/Jakarta").ms / 1000).toBe(1700000000);
    expect(ok("2023-11-15T05:13:20+07:00", "America/New_York").ms / 1000).toBe(1700000000);
    expect(ok("2023-11-15T05:13:20+0700").ms / 1000).toBe(1700000000);
    expect(ok("2023-11-14T17:13:20-05").ms / 1000).toBe(1700000000);
    expect(ok("2023-11-14T22:13:20z").usedOffset).toBe("explicit");
  });

  it("accepts date-only, minutes-only and fractional seconds", () => {
    expect(ok("2023-11-14").ms).toBe(Date.UTC(2023, 10, 14));
    expect(ok("2023-11-14T22:13").ms).toBe(Date.UTC(2023, 10, 14, 22, 13));
    expect(ok("2023-11-14 22:13:20.5").ms).toBe(1700000000500);
    expect(ok("2023-11-14 22:13:20,123456789").ms).toBe(1700000000123);
    expect(ok("  2023-11-14 22:13:20  ").ms / 1000).toBe(1700000000);
  });

  it("handles leap days, early years and negative dates", () => {
    expect(ok("2000-02-29").ms).toBe(951782400000);
    expect(ok("1970-01-01T00:00:00Z").ms).toBe(0);
    expect(ok("1969-12-31T23:59:59Z").ms).toBe(-1000);
    expect(ok("0050-06-15T00:00:00Z").view.utcIso).toBe("0050-06-15T00:00:00.000Z");
  });

  it("resolves DST gaps forward and overlaps to the first occurrence (matches Python fold=0)", () => {
    expect(ok("2024-03-10 02:30:00", "America/New_York").ms / 1000).toBe(1710055800); // 02:30 does not exist
    expect(ok("2024-03-10 02:30:00", "America/New_York").view.zonedText).toBe("2024-03-10 03:30:00.000");
    expect(ok("2024-11-03 01:30:00", "America/New_York").ms / 1000).toBe(1730611800); // 01:30 happens twice
    expect(ok("2024-11-03 01:30:00", "America/New_York").view.zonedIso).toBe("2024-11-03T01:30:00.000-04:00");
  });

  it("round-trips instants through every zone", () => {
    for (const tz of ["UTC", "Asia/Jakarta", "America/New_York", "Asia/Kolkata", "Australia/Lord_Howe", "Europe/London"]) {
      for (const ts of [1700000000, 1720000000, 951782400, 1000000000, 1900000000]) {
        const v = view(ts, tz);
        expect(ok(v.zonedText, tz).ms / 1000, `${tz} ${ts}`).toBe(ts);
        expect(ok(v.zonedIso, "UTC").ms / 1000, `${tz} ${ts} iso`).toBe(ts);
      }
    }
  });

  it("rejects invalid dates with a helpful message", () => {
    expect(err("not a date")).toMatch(/Use a format like/);
    expect(err("2023-13-01")).toMatch(/Month must be 01-12/);
    expect(err("2023-00-10")).toMatch(/Month must be 01-12/);
    expect(err("2023-02-29")).toMatch(/Day 29 does not exist in 2023-02/);
    expect(err("2024-04-31")).toMatch(/Day 31 does not exist/);
    expect(err("2023-01-01T24:00:00")).toMatch(/Hour must be 00-23/);
    expect(err("2023-01-01T10:60:00")).toMatch(/Minute must be 00-59/);
    expect(err("2023-01-01T10:10:60")).toMatch(/Second must be 00-59/);
    expect(err("2023-01-01T10:10:10+25:00")).toMatch(/Invalid UTC offset/);
    expect(err("2023-01-01", "Nope/Zone")).toMatch(/Unknown time zone/);
    expect(err("1900-02-29")).toMatch(/does not exist/); // 1900 is not a leap year
  });
});
