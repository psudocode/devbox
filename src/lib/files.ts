/** Human readable size, base 1024 (KiB, MiB...). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/**
 * Check a file against an `accept` string like the HTML attribute:
 * comma separated extensions (`.json`), exact MIME types (`image/png`) or wildcards (`image/*`).
 * Empty/undefined accept means everything is accepted.
 */
export function matchesAccept(file: { name: string; type: string }, accept: string | undefined): boolean {
  const rules = (accept ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}
