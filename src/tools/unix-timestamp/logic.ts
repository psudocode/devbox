/** Unix timestamp <-> date conversion with explicit time zones (IANA names via Intl, no dependency). */

export type Unit = "auto" | "s" | "ms" | "us" | "ns";
export type ConcreteUnit = Exclude<Unit, "auto">;

const MAX_MS = 8.64e15; // JS Date range

/** Convert a value in `unit` to milliseconds (divide for sub-ms units to avoid float error). */
const toMs = (value: number, unit: ConcreteUnit): number =>
  unit === "s" ? value * 1000 : unit === "ms" ? value : unit === "us" ? value / 1000 : value / 1_000_000;

export const UNIT_LABEL: Record<ConcreteUnit, string> = { s: "seconds", ms: "milliseconds", us: "microseconds", ns: "nanoseconds" };

/** Guess the unit from the magnitude: < 1e11 s (to year 5138), < 1e14 ms, < 1e17 µs, else ns. */
export function detectUnit(value: number): ConcreteUnit {
  const abs = Math.abs(value);
  if (abs < 1e11) return "s";
  if (abs < 1e14) return "ms";
  if (abs < 1e17) return "us";
  return "ns";
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      era: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant in a time zone. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let year = Number(get("year"));
  if (get("era").startsWith("B")) year = 1 - year; // BC years: astronomical numbering
  return {
    year,
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    millisecond: ((ms % 1000) + 1000) % 1000,
  };
}

/** Offset of `timeZone` from UTC at an instant, in minutes (positive = ahead of UTC). */
export function offsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(Math.floor(ms / 1000) * 1000, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");

function yearText(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return `${year < 0 ? "-" : "+"}${pad(year, 6)}`;
}

export interface InstantView {
  /** Unix time in whole + fractional milliseconds. */
  ms: number;
  seconds: number;
  utcIso: string;
  /** ISO 8601 in the chosen zone, with its numeric offset. */
  zonedIso: string;
  /** Human readable `YYYY-MM-DD HH:mm:ss.SSS` in the chosen zone. */
  zonedText: string;
  offset: string;
  weekday: string;
  /** Short zone name such as WIB or EST. */
  zoneName: string;
}

export function describeInstant(ms: number, timeZone: string): InstantView {
  const offset = offsetMinutes(ms, timeZone);
  const p = zonedParts(ms, timeZone);
  const date = `${yearText(p.year)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond, 3)}`;
  const offsetText = formatOffset(offset);
  const nameParts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(ms));
  return {
    ms,
    seconds: Math.floor(ms / 1000),
    utcIso: Math.abs(ms) <= MAX_MS ? new Date(ms).toISOString() : "",
    zonedIso: `${date}T${time}${offsetText}`,
    zonedText: `${date} ${time}`,
    offset: offsetText,
    weekday: new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date(ms)),
    zoneName: nameParts.find((x) => x.type === "timeZoneName")?.value ?? "",
  };
}

export type TimestampResult =
  | { ok: true; unit: ConcreteUnit; detected: boolean; view: InstantView }
  | { ok: false; error: string };

/** Interpret a number (integer or decimal) as a Unix timestamp and describe it in `timeZone`. */
export function timestampToDate(input: string, unit: Unit, timeZone: string): TimestampResult {
  const text = input.trim().replace(/[_,\s]/g, "");
  if (text === "") return { ok: false, error: "Enter a timestamp" };
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "A timestamp is a number such as 1700000000 or 1700000000.123" };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone "${timeZone}"` };

  const value = Number(text);
  const concrete = unit === "auto" ? detectUnit(value) : unit;
  const msValue = toMs(value, concrete);
  if (!Number.isFinite(msValue) || Math.abs(msValue) > MAX_MS) {
    return { ok: false, error: `That value is outside the supported date range when read as ${UNIT_LABEL[concrete]}` };
  }
  return { ok: true, unit: concrete, detected: unit === "auto", view: describeInstant(msValue, timeZone) };
}

// ---------------------------------------------------------------- date -> timestamp

const DATE_RE =
  /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

export type DateResult =
  | { ok: true; ms: number; usedOffset: "explicit" | "zone"; view: InstantView }
  | { ok: false; error: string };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (year: number, month: number) =>
  [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

/**
 * Parse `YYYY-MM-DD[ T]HH:mm[:ss[.fff]][Z|±hh[:mm]]`.
 * Without an explicit offset the wall-clock time is read in `timeZone`.
 * Skipped DST hours (spring forward) resolve forward; repeated hours (fall back) resolve to the first occurrence.
 */
export function dateToTimestamp(input: string, timeZone: string): DateResult {
  const m = DATE_RE.exec(input.trim());
  if (!m) return { ok: false, error: "Use a format like 2026-11-25 01:30:00, 2026-11-25T01:30:00+07:00 or 2026-11-25T01:30:00Z" };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone "${timeZone}"` };

  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const millisecond = Number((frac + "000").slice(0, 3));

  if (month < 1 || month > 12) return { ok: false, error: `Month must be 01-12, got ${mo}` };
  if (day < 1 || day > daysInMonth(year, month)) return { ok: false, error: `Day ${d} does not exist in ${y}-${mo}` };
  if (hour > 23) return { ok: false, error: `Hour must be 00-23, got ${h}` };
  if (minute > 59) return { ok: false, error: `Minute must be 00-59, got ${mi}` };
  if (second > 59) return { ok: false, error: `Second must be 00-59, got ${s}` };

  const wall = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  // Date.UTC treats years 0-99 as 1900-1999: fix up explicitly.
  const fixedWall = year >= 0 && year < 100 ? new Date(wall).setUTCFullYear(year) : wall;

  let ms: number;
  let usedOffset: "explicit" | "zone";
  if (zone) {
    usedOffset = "explicit";
    if (zone.toUpperCase() === "Z") ms = fixedWall;
    else {
      const sign = zone[0] === "-" ? -1 : 1;
      const digits = zone.slice(1).replace(":", "");
      const oh = Number(digits.slice(0, 2));
      const om = Number(digits.slice(2) || "0");
      if (oh > 23 || om > 59) return { ok: false, error: `Invalid UTC offset "${zone}"` };
      ms = fixedWall - sign * (oh * 60 + om) * 60000;
    }
  } else {
    usedOffset = "zone";
    ms = resolveWallClock(fixedWall, timeZone);
  }

  if (Math.abs(ms) > MAX_MS) return { ok: false, error: "That date is outside the supported range" };
  return { ok: true, ms, usedOffset, view: describeInstant(ms, timeZone) };
}

/**
 * UTC instant whose wall clock in `timeZone` shows `wall` (given as if it were UTC).
 * Repeated hour (clocks go back): the earlier instant wins. Skipped hour (clocks go forward): resolves forward.
 */
function resolveWallClock(wall: number, timeZone: string): number {
  const before = offsetMinutes(wall - 86_400_000, timeZone);
  const after = offsetMinutes(wall + 86_400_000, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset * 60_000)
    .filter((instant) => offsetMinutes(instant, timeZone) === (wall - instant) / 60_000);
  return valid.length > 0 ? Math.min(...valid) : wall - before * 60_000;
}
