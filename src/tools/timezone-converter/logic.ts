import {
  dateToTimestamp,
  describeInstant,
  formatOffset,
  isValidTimeZone,
  offsetMinutes,
  zonedParts,
  type InstantView,
} from "../unix-timestamp/logic";

export const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
] as const;

export interface ConvertedZoneView {
  timeZone: string;
  view: InstantView;
  offsetMinutes: number;
  diffMinutesFromSource: number;
  diffLabel: string;
  dayShift: number;
}

export type ConvertTimeZoneResult =
  | {
      ok: true;
      ms: number;
      usedOffset: "explicit" | "zone";
      source: ConvertedZoneView;
      targets: ConvertedZoneView[];
    }
  | { ok: false; error: string };

/** Format a minute difference relative to the source time zone, e.g. "same", "+07:00", "-05:30". */
export function formatDiffLabel(diffMinutes: number): string {
  if (diffMinutes === 0) return "same";
  return formatOffset(diffMinutes);
}

function buildZoneView(ms: number, timeZone: string, sourceOffsetMin: number, sourceDayNumber: number): ConvertedZoneView {
  const view = describeInstant(ms, timeZone);
  const off = offsetMinutes(ms, timeZone);
  const p = zonedParts(ms, timeZone);
  const targetDayNumber = Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
  const diffMinutesFromSource = off - sourceOffsetMin;
  return {
    timeZone,
    view,
    offsetMinutes: off,
    diffMinutesFromSource,
    diffLabel: formatDiffLabel(diffMinutesFromSource),
    dayShift: targetDayNumber - sourceDayNumber,
  };
}

/**
 * Convert a date/time string (in `fromZone`, or with an explicit `Z`/`±hh:mm` offset)
 * into one or more target IANA time zones.
 */
export function convertTimeZone(input: string, fromZone: string, toZones: readonly string[]): ConvertTimeZoneResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter a date and time to convert" };

  const parsed = dateToTimestamp(trimmed, fromZone);
  if (!parsed.ok) return parsed;

  for (const tz of toZones) {
    if (!isValidTimeZone(tz)) return { ok: false, error: `Unknown target time zone "${tz}"` };
  }

  const sourceOffset = offsetMinutes(parsed.ms, fromZone);
  const sp = zonedParts(parsed.ms, fromZone);
  const sourceDayNumber = Math.floor(Date.UTC(sp.year, sp.month - 1, sp.day) / 86_400_000);

  const source = buildZoneView(parsed.ms, fromZone, sourceOffset, sourceDayNumber);
  const uniqueTargets = [...new Set(toZones)];
  const targets = uniqueTargets.map((tz) => buildZoneView(parsed.ms, tz, sourceOffset, sourceDayNumber));

  return {
    ok: true,
    ms: parsed.ms,
    usedOffset: parsed.usedOffset,
    source,
    targets,
  };
}
