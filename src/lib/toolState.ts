import type { KeyValueStorage } from "./theme";

/** Soft limit: URLs beyond this are likely to be truncated by chat apps and some servers. */
export const MAX_SHARE_STATE_LENGTH = 6000;

const STORAGE_PREFIX = "devbox:tool:";

export const toolStorageKey = (toolId: string) => `${STORAGE_PREFIX}${toolId}`;

/** JSON -> UTF-8 -> base64url (no padding). Safe to put in a URL hash. */
export function encodeState(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of `encodeState`. Returns undefined for anything malformed (never throws). */
export function decodeState(encoded: string): unknown {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

/** Loose runtime check that a decoded value looks like the tool's default state (same JSON kind). */
export function hasSameShape(value: unknown, template: unknown): boolean {
  const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  if (kind(value) !== kind(template)) return false;
  if (kind(template) !== "object") return true;
  // Objects: every key of the template must exist with the same kind (extra keys are tolerated).
  const v = value as Record<string, unknown>;
  const t = template as Record<string, unknown>;
  return Object.keys(t).every((key) => key in v && kind(v[key]) === kind(t[key]));
}

export function loadToolState(storage: KeyValueStorage | undefined, toolId: string): unknown {
  try {
    const raw = storage?.getItem(toolStorageKey(toolId));
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function saveToolState(storage: KeyValueStorage | undefined, toolId: string, value: unknown): void {
  try {
    storage?.setItem(toolStorageKey(toolId), JSON.stringify(value));
  } catch {
    // quota exceeded or storage blocked: persistence is best-effort
  }
}

/**
 * Pick the initial state for a tool: shared URL state wins, then the last saved input, then the default.
 * Anything with the wrong shape is ignored.
 */
export function resolveInitialState<T>(
  toolId: string,
  defaultValue: T,
  sharedState: string | undefined,
  storage: KeyValueStorage | undefined,
): T {
  if (sharedState) {
    const shared = decodeState(sharedState);
    if (shared !== undefined && hasSameShape(shared, defaultValue)) return shared as T;
  }
  const saved = loadToolState(storage, toolId);
  if (saved !== undefined && hasSameShape(saved, defaultValue)) return saved as T;
  return defaultValue;
}
