const UNITS: [number, string][] = [
  [365 * 24 * 3600, "year"],
  [30 * 24 * 3600, "month"],
  [24 * 3600, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/** "in 2 hours" / "3 days ago" for a target time relative to now. */
export function formatRelative(targetSeconds: number, nowMs: number): string {
  const delta = Math.round(targetSeconds - nowMs / 1000);
  const abs = Math.abs(delta);
  if (abs < 1) return "now";
  const [size, name] = UNITS.find(([s]) => abs >= s) ?? UNITS[UNITS.length - 1];
  const count = Math.floor(abs / size);
  const text = `${count} ${name}${count === 1 ? "" : "s"}`;
  return delta > 0 ? `in ${text}` : `${text} ago`;
}
