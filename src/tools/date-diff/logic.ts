import {
  dateToTimestamp,
  describeInstant,
  isValidTimeZone,
  zonedParts,
  type InstantView,
  type ZonedParts,
} from "../unix-timestamp/logic";

export interface CalendarBreakdown {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface DateDiffView {
  direction: "forward" | "backward" | "same";
  start: InstantView;
  end: InstantView;
  breakdown: CalendarBreakdown;
  isoDuration: string;
  humanReadable: string;
  totalMilliseconds: number;
  totalSeconds: number;
  totalMinutes: number;
  totalHours: number;
  totalDays: number;
  totalWeeks: number;
  weekdays: number;
  weekendDays: number;
}

export type DateDiffResult = { ok: true; diff: DateDiffView } | { ok: false; error: string };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (year: number, month: number) =>
  [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

/**
 * Calendar-accurate difference between two instants `earlierMs <= laterMs` in `timeZone`.
 */
function computeCalendarBreakdown(earlierMs: number, laterMs: number, timeZone: string): CalendarBreakdown {
  const a: ZonedParts = zonedParts(earlierMs, timeZone);
  const b: ZonedParts = zonedParts(laterMs, timeZone);

  let years = b.year - a.year;
  let months = b.month - a.month;
  let days = b.day - a.day;
  let hours = b.hour - a.hour;
  let minutes = b.minute - a.minute;
  let seconds = b.second - a.second;
  let milliseconds = b.millisecond - a.millisecond;

  if (milliseconds < 0) {
    milliseconds += 1000;
    seconds -= 1;
  }
  if (seconds < 0) {
    seconds += 60;
    minutes -= 1;
  }
  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }
  if (hours < 0) {
    hours += 24;
    days -= 1;
  }
  if (days < 0) {
    // Borrow days from the month preceding `b`
    const prevMonth = b.month === 1 ? 12 : b.month - 1;
    const prevYear = b.month === 1 ? b.year - 1 : b.year;
    days += daysInMonth(prevYear, prevMonth);
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return { years, months, days, hours, minutes, seconds, milliseconds };
}

export function formatIsoDuration(b: CalendarBreakdown, negative = false): string {
  const dateParts: string[] = [];
  if (b.years) dateParts.push(`${b.years}Y`);
  if (b.months) dateParts.push(`${b.months}M`);
  if (b.days) dateParts.push(`${b.days}D`);

  const timeParts: string[] = [];
  if (b.hours) timeParts.push(`${b.hours}H`);
  if (b.minutes) timeParts.push(`${b.minutes}M`);
  if (b.seconds || b.milliseconds) {
    const sec = b.milliseconds ? `${b.seconds}.${String(b.milliseconds).padStart(3, "0").replace(/0+$/, "")}` : `${b.seconds}`;
    timeParts.push(`${sec}S`);
  }

  if (dateParts.length === 0 && timeParts.length === 0) return "PT0S";
  const prefix = negative ? "-P" : "P";
  return `${prefix}${dateParts.join("")}${timeParts.length > 0 ? `T${timeParts.join("")}` : ""}`;
}

export function formatHumanBreakdown(b: CalendarBreakdown): string {
  const parts: string[] = [];
  const push = (n: number, unit: string) => {
    if (n > 0) parts.push(`${n} ${unit}${n === 1 ? "" : "s"}`);
  };
  push(b.years, "year");
  push(b.months, "month");
  push(b.days, "day");
  push(b.hours, "hour");
  push(b.minutes, "minute");
  push(b.seconds, "second");
  if (parts.length === 0) {
    return b.milliseconds > 0 ? `${b.milliseconds} ms` : "0 seconds";
  }
  return parts.join(", ");
}

/** Count calendar weekdays (Mon-Fri) and weekend days (Sat-Sun) between two zoned dates inclusive of start, exclusive of end (or inclusive of 1 day if same date). */
function countDayTypes(earlierMs: number, laterMs: number, timeZone: string): { weekdays: number; weekendDays: number } {
  const a = zonedParts(earlierMs, timeZone);
  const b = zonedParts(laterMs, timeZone);
  const startDay = Math.floor(Date.UTC(a.year, a.month - 1, a.day) / 86_400_000);
  const endDay = Math.floor(Date.UTC(b.year, b.month - 1, b.day) / 86_400_000);
  const span = Math.max(0, endDay - startDay);

  if (span === 0) return { weekdays: 0, weekendDays: 0 };

  const fullWeeks = Math.floor(span / 7);
  let weekdays = fullWeeks * 5;
  let weekendDays = fullWeeks * 2;
  const rem = span % 7;
  const startDow = new Date(startDay * 86_400_000).getUTCDay();

  for (let i = 0; i < rem; i++) {
    const dow = (startDow + i) % 7;
    if (dow === 0 || dow === 6) weekendDays++;
    else weekdays++;
  }
  return { weekdays, weekendDays };
}

/** Calculate the difference between two date/time strings in `timeZone`. */
export function diffDates(startInput: string, endInput: string, timeZone: string): DateDiffResult {
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone "${timeZone}"` };
  if (startInput.trim() === "") return { ok: false, error: "Enter a start date" };
  if (endInput.trim() === "") return { ok: false, error: "Enter an end date" };

  const startRes = dateToTimestamp(startInput, timeZone);
  if (!startRes.ok) return { ok: false, error: `Start date: ${startRes.error}` };
  const endRes = dateToTimestamp(endInput, timeZone);
  if (!endRes.ok) return { ok: false, error: `End date: ${endRes.error}` };

  const delta = endRes.ms - startRes.ms;
  const direction: DateDiffView["direction"] = delta > 0 ? "forward" : delta < 0 ? "backward" : "same";
  const earlierMs = Math.min(startRes.ms, endRes.ms);
  const laterMs = Math.max(startRes.ms, endRes.ms);

  const breakdown = computeCalendarBreakdown(earlierMs, laterMs, timeZone);
  const absMs = laterMs - earlierMs;
  const { weekdays, weekendDays } = countDayTypes(earlierMs, laterMs, timeZone);

  return {
    ok: true,
    diff: {
      direction,
      start: startRes.view,
      end: endRes.view,
      breakdown,
      isoDuration: formatIsoDuration(breakdown, direction === "backward"),
      humanReadable: formatHumanBreakdown(breakdown),
      totalMilliseconds: absMs,
      totalSeconds: absMs / 1000,
      totalMinutes: absMs / 60_000,
      totalHours: absMs / 3_600_000,
      totalDays: absMs / 86_400_000,
      totalWeeks: absMs / (7 * 86_400_000),
      weekdays,
      weekendDays,
    },
  };
}

// ---------------------------------------------------------------- ISO 8601 duration parser & arithmetic

export interface IsoDuration {
  sign: 1 | -1;
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const ISO_DURATION_RE =
  /^([+-])?P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

export type ParseIsoDurationResult = { ok: true; duration: IsoDuration } | { ok: false; error: string };

/** Parse an ISO 8601 duration string such as `P1Y2M3DT4H5M6S`, `P2W`, or `-PT30M`. */
export function parseIsoDuration(input: string): ParseIsoDurationResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter an ISO 8601 duration (e.g. P1Y2M3DT4H5M6S or PT30M)" };
  if (trimmed.toUpperCase() === "P" || trimmed.toUpperCase() === "PT" || /^[+-]?PT?$/i.test(trimmed)) {
    return { ok: false, error: "Duration has no components" };
  }

  const m = ISO_DURATION_RE.exec(trimmed);
  if (!m) return { ok: false, error: "Invalid ISO 8601 duration. Example: P1Y2M3DT4H5M6S, P2W, PT45M" };

  const num = (s: string | undefined) => (s ? Number(s.replace(",", ".")) : 0);
  const hasAny = m.slice(2).some((v) => v !== undefined);
  if (!hasAny) return { ok: false, error: "Duration must contain at least one component" };

  return {
    ok: true,
    duration: {
      sign: m[1] === "-" ? -1 : 1,
      years: num(m[2]),
      months: num(m[3]),
      weeks: num(m[4]),
      days: num(m[5]),
      hours: num(m[6]),
      minutes: num(m[7]),
      seconds: num(m[8]),
    },
  };
}

export type AddDurationResult = { ok: true; view: InstantView } | { ok: false; error: string };

/** Add or subtract an ISO 8601 duration to/from a date string in `timeZone`. */
export function addIsoDuration(
  dateInput: string,
  durationInput: string,
  timeZone: string,
  subtract = false,
): AddDurationResult {
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone "${timeZone}"` };
  const dateRes = dateToTimestamp(dateInput, timeZone);
  if (!dateRes.ok) return { ok: false, error: dateRes.error };

  const durRes = parseIsoDuration(durationInput);
  if (!durRes.ok) return durRes;

  const d = durRes.duration;
  const s = (subtract ? -1 : 1) * d.sign;

  const p = zonedParts(dateRes.ms, timeZone);
  // Apply year/month calendar shifts first, clamping day to month length
  const totalMonths = p.year * 12 + (p.month - 1) + Math.trunc(s * (d.years * 12 + d.months));
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1;
  const targetDay = Math.min(p.day, daysInMonth(targetYear, targetMonth));

  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const shiftedWallStr = `${targetYear < 0 ? "-" : ""}${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(targetDay)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond, 3)}`;
  const shiftedBase = dateToTimestamp(shiftedWallStr, timeZone);
  if (!shiftedBase.ok) return shiftedBase;

  const extraMs = s * ((d.weeks * 7 + d.days) * 86_400_000 + d.hours * 3_600_000 + d.minutes * 60_000 + d.seconds * 1000);
  const finalMs = shiftedBase.ms + Math.round(extraMs);
  if (Math.abs(finalMs) > 8.64e15) return { ok: false, error: "Resulting date is outside the supported range" };

  return { ok: true, view: describeInstant(finalMs, timeZone) };
}
