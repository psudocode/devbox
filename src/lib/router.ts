/**
 * Minimal hash router. Works on any static host (no server rewrites needed).
 *   ""  / "#" / "#/"      -> home
 *   "#/json-formatter"    -> tool page
 *   "#/base64?s=<state>"  -> tool page with shared state (see toolState.ts)
 * Anything else after the tool id is ignored.
 */
export type Route = { name: "home" } | { name: "tool"; toolId: string; state?: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [segment] = path.split(/[/?]/, 1);
  if (!segment) return { name: "home" };
  const queryStart = path.indexOf("?");
  const state = queryStart === -1 ? undefined : new URLSearchParams(path.slice(queryStart + 1)).get("s") || undefined;
  let toolId = segment;
  try {
    toolId = decodeURIComponent(segment);
  } catch {
    // malformed escape sequence: keep the raw segment, it simply won't match a tool
  }
  return state === undefined ? { name: "tool", toolId } : { name: "tool", toolId, state };
}

/** Hash for a tool page, optionally carrying shared state (already encoded, see `encodeState`). */
export function toolHash(toolId: string, state?: string): string {
  const base = `#/${encodeURIComponent(toolId)}`;
  return state ? `${base}?s=${encodeURIComponent(state)}` : base;
}

export const HOME_HASH = "#/";
