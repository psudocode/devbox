import { isValidTimeZone } from "./logic";

const FALLBACK_ZONES = [
  "UTC",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

export function localTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** All IANA zones the browser knows (falls back to a short list on older engines), UTC and the local zone first. */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const all = supported ? supported("timeZone") : FALLBACK_ZONES;
  const first = ["UTC", localTimeZone()];
  return [...new Set([...first, ...all])];
}
