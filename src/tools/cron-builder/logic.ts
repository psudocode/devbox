import { describeInstant, isValidTimeZone, zonedParts, type InstantView } from "../unix-timestamp/logic";

export interface CronPreset {
  label: string;
  expression: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: "Every minute", expression: "* * * * *" },
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Daily at midnight", expression: "0 0 * * *" },
  { label: "Weekdays at 09:00", expression: "0 9 * * 1-5" },
  { label: "Monthly on the 1st", expression: "0 0 1 * *" },
  { label: "Sundays at 00:00", expression: "0 0 * * 0" },
];

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface FieldSpec {
  name: string;
  min: number;
  max: number;
  names?: readonly string[];
  wrapSevenToZero?: boolean;
}

export const CRON_FIELD_SPECS: readonly FieldSpec[] = [
  { name: "Minute", min: 0, max: 59 },
  { name: "Hour", min: 0, max: 23 },
  { name: "Day of month", min: 1, max: 31 },
  { name: "Month", min: 1, max: 12, names: MONTH_NAMES },
  { name: "Day of week", min: 0, max: 7, names: WEEKDAY_NAMES, wrapSevenToZero: true },
];

export interface ParsedCronField {
  raw: string;
  isWildcard: boolean;
  values: number[];
}

export interface ParsedCron {
  raw: string;
  normalized: string;
  macro?: string;
  fields: [ParsedCronField, ParsedCronField, ParsedCronField, ParsedCronField, ParsedCronField];
}

export type ParseCronResult = { ok: true; cron: ParsedCron } | { ok: false; error: string };

function parseAtom(token: string, spec: FieldSpec): number | null {
  const lower = token.toLowerCase();
  if (spec.names) {
    const idx = spec.names.indexOf(lower);
    if (idx !== -1) return spec.min + idx;
  }
  if (!/^\d+$/.test(token)) return null;
  const n = Number(token);
  if (n < spec.min || n > spec.max) return null;
  return n;
}

function parseField(raw: string, spec: FieldSpec): { ok: true; field: ParsedCronField } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: `${spec.name} is empty` };

  const set = new Set<number>();
  const parts = trimmed.split(",");
  for (const part of parts) {
    if (part === "") return { ok: false, error: `${spec.name}: empty list item in "${trimmed}"` };
    const slashParts = part.split("/");
    if (slashParts.length > 2) return { ok: false, error: `${spec.name}: invalid step syntax "${part}"` };

    const [rangePart, stepPart] = slashParts;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) {
        return { ok: false, error: `${spec.name}: step must be a positive integer in "${part}"` };
      }
      step = Number(stepPart);
    }

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = spec.min;
      end = spec.wrapSevenToZero ? 6 : spec.max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) return { ok: false, error: `${spec.name}: invalid range "${rangePart}"` };
      const a = parseAtom(bounds[0], spec);
      const b = parseAtom(bounds[1], spec);
      if (a === null || b === null) return { ok: false, error: `${spec.name}: out-of-range or unknown value in "${rangePart}"` };
      if (a > b) return { ok: false, error: `${spec.name}: range start ${bounds[0]} > end ${bounds[1]}` };
      start = a;
      end = b;
    } else {
      const single = parseAtom(rangePart, spec);
      if (single === null) return { ok: false, error: `${spec.name}: invalid value "${rangePart}"` };
      start = single;
      end = stepPart !== undefined ? (spec.wrapSevenToZero ? 6 : spec.max) : single;
    }

    for (let v = start; v <= end; v += step) {
      set.add(spec.wrapSevenToZero && v === 7 ? 0 : v);
    }
  }

  const values = [...set].sort((a, b) => a - b);
  return {
    ok: true,
    field: {
      raw: trimmed,
      isWildcard: trimmed === "*",
      values,
    },
  };
}

/** Parse and validate a 5-field cron expression or standard @macro. */
export function parseCron(expression: string): ParseCronResult {
  const trimmed = expression.trim();
  if (trimmed === "") return { ok: false, error: "Enter a cron expression (5 fields, e.g. */5 * * * *)" };

  const lower = trimmed.toLowerCase();
  const macroExpanded = MACROS[lower];
  const source = macroExpanded ?? trimmed;
  const tokens = source.split(/\s+/);
  if (tokens.length !== 5) {
    return { ok: false, error: `Expected 5 fields (minute hour day month weekday), got ${tokens.length}` };
  }

  const parsedFields: ParsedCronField[] = [];
  for (let i = 0; i < 5; i++) {
    const res = parseField(tokens[i], CRON_FIELD_SPECS[i]);
    if (!res.ok) return { ok: false, error: res.error };
    parsedFields.push(res.field);
  }

  return {
    ok: true,
    cron: {
      raw: trimmed,
      normalized: tokens.join(" "),
      macro: macroExpanded ? lower : undefined,
      fields: parsedFields as ParsedCron["fields"],
    },
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function describeFieldValues(field: ParsedCronField, index: number): string {
  if (field.isWildcard) return "every";
  if (field.raw.startsWith("*/")) {
    const step = field.raw.slice(2);
    return `every ${step}`;
  }
  if (index === 3) {
    return formatList(field.values.map((v) => MONTH_LABELS[v - 1]));
  }
  if (index === 4) {
    if (field.values.length === 5 && field.values.join(",") === "1,2,3,4,5") return "Monday through Friday";
    if (field.values.length === 2 && field.values.join(",") === "0,6") return "weekends";
    return formatList(field.values.map((v) => WEEKDAY_LABELS[v]));
  }
  return formatList(field.values.map((v) => String(v)));
}

/** Generate a clear English summary of a valid cron expression. */
export function explainCron(expression: string): { ok: true; summary: string; fieldDescriptions: { name: string; raw: string; description: string }[] } | { ok: false; error: string } {
  const parsed = parseCron(expression);
  if (!parsed.ok) return parsed;

  const [min, hour, dom, month, dow] = parsed.cron.fields;

  let timePart: string;
  if (min.isWildcard && hour.isWildcard) {
    timePart = "Every minute";
  } else if (min.raw.startsWith("*/") && hour.isWildcard) {
    timePart = `Every ${min.raw.slice(2)} minutes`;
  } else if (min.values.length === 1 && hour.isWildcard) {
    timePart = min.values[0] === 0 ? "Every hour" : `At minute ${min.values[0]} of every hour`;
  } else if (min.values.length === 1 && hour.values.length === 1) {
    timePart = `At ${pad2(hour.values[0])}:${pad2(min.values[0])}`;
  } else if (min.values.length === 1 && hour.raw.startsWith("*/")) {
    timePart = `At minute ${min.values[0]}, every ${hour.raw.slice(2)} hours`;
  } else {
    const minText = min.isWildcard ? "every minute" : `minute ${describeFieldValues(min, 0)}`;
    const hourText = hour.isWildcard ? "every hour" : `hour ${describeFieldValues(hour, 1)}`;
    timePart = `At ${minText} past ${hourText}`;
  }

  const parts: string[] = [timePart];
  if (!dom.isWildcard && !dow.isWildcard) {
    parts.push(`on day ${describeFieldValues(dom, 2)} of the month or on ${describeFieldValues(dow, 4)}`);
  } else if (!dom.isWildcard) {
    parts.push(`on day ${describeFieldValues(dom, 2)} of the month`);
  } else if (!dow.isWildcard) {
    parts.push(`on ${describeFieldValues(dow, 4)}`);
  }

  if (!month.isWildcard) {
    parts.push(`in ${describeFieldValues(month, 3)}`);
  }

  const fieldDescriptions = parsed.cron.fields.map((f, i) => ({
    name: CRON_FIELD_SPECS[i].name,
    raw: f.raw,
    description: f.isWildcard ? `Every ${CRON_FIELD_SPECS[i].name.toLowerCase()}` : describeFieldValues(f, i),
  }));

  return { ok: true, summary: parts.join(" "), fieldDescriptions };
}

export type NextRunsResult =
  | { ok: true; runs: InstantView[] }
  | { ok: false; error: string };

/**
 * Compute the next `count` matching run times after `fromMs` in `timeZone`.
 * Uses standard Vixie cron semantics: if both day-of-month and day-of-week are restricted,
 * a date matches if either matches.
 */
export function nextCronRuns(expression: string, count = 10, fromMs = Date.now(), timeZone = "UTC"): NextRunsResult {
  if (!isValidTimeZone(timeZone)) return { ok: false, error: `Unknown time zone "${timeZone}"` };
  const parsed = parseCron(expression);
  if (!parsed.ok) return parsed;

  const limit = Math.max(1, Math.min(50, Math.floor(count)));
  const [minF, hourF, domF, monthF, dowF] = parsed.cron.fields;

  const minSet = new Set(minF.values);
  const hourSet = new Set(hourF.values);
  const domSet = new Set(domF.values);
  const monthSet = new Set(monthF.values);
  const dowSet = new Set(dowF.values);

  const bothRestricted = !domF.isWildcard && !dowF.isWildcard;
  const runs: InstantView[] = [];

  // Start at the next whole minute after fromMs
  let cursor = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const maxCursor = cursor + 5 * 366 * 24 * 60 * 60_000;
  let iterations = 0;
  const MAX_ITERATIONS = 120_000;

  while (runs.length < limit && cursor <= maxCursor && iterations < MAX_ITERATIONS) {
    iterations++;
    const p = zonedParts(cursor, timeZone);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();

    const monthOk = monthSet.has(p.month);
    const dayOk = bothRestricted
      ? domSet.has(p.day) || dowSet.has(weekday)
      : (domF.isWildcard || domSet.has(p.day)) && (dowF.isWildcard || dowSet.has(weekday));

    if (!monthOk || !dayOk) {
      // Jump ahead safely to 22:00 or next hour :00 without skipping across a DST midnight boundary
      if (p.hour < 22) {
        cursor += (22 - p.hour) * 3_600_000 - p.minute * 60_000;
      } else {
        cursor += (60 - p.minute) * 60_000;
      }
      continue;
    }

    if (!hourSet.has(p.hour)) {
      cursor += (60 - p.minute) * 60_000;
      continue;
    }

    if (minSet.has(p.minute)) {
      runs.push(describeInstant(cursor, timeZone));
    }
    cursor += 60_000;
  }

  if (runs.length === 0) {
    return { ok: false, error: "No matching run found within the next 5 years (check day/month combination)" };
  }

  return { ok: true, runs };
}
