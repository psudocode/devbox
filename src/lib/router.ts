/**
 * Minimal hash router. Works on any static host (no server rewrites needed).
 *   ""  / "#" / "#/"      -> home
 *   "#/json-formatter"    -> tool page
 * Anything after the tool id (`/...` or `?...`) is reserved for tool state (shareable URLs).
 */
export type Route = { name: "home" } | { name: "tool"; toolId: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [segment] = path.split(/[/?]/, 1);
  if (!segment) return { name: "home" };
  let toolId = segment;
  try {
    toolId = decodeURIComponent(segment);
  } catch {
    // malformed escape sequence: keep the raw segment, it simply won't match a tool
  }
  return { name: "tool", toolId };
}

export function toolHash(toolId: string): string {
  return `#/${encodeURIComponent(toolId)}`;
}

export const HOME_HASH = "#/";
