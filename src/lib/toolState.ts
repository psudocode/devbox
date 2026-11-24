import { base64ToBytes, bytesToBase64 } from "./base64";
import type { KeyValueStorage } from "./theme";

/** Soft limit: URLs beyond this are likely to be truncated by chat apps and some servers. */
export const MAX_SHARE_STATE_LENGTH = 6000;

const STORAGE_PREFIX = "devbox:tool:";

export const toolStorageKey = (toolId: string) => `${STORAGE_PREFIX}${toolId}`;

/** JSON -> UTF-8 -> base64url (no padding). Safe to put in a URL hash. */
export function encodeState(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return bytesToBase64(bytes, { urlSafe: true, padding: false });
}

/** Inverse of `encodeState`. Returns undefined for anything malformed (never throws). */
export function decodeState(encoded: string): unknown {
  try {
    // Only the URL-safe alphabet without padding is ever produced by encodeState.
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
    const decoded = base64ToBytes(encoded);
    if (!decoded.ok) return undefined;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded.bytes));
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
