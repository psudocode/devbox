import type { KeyValueStorage } from "./theme";

export const FAVORITES_KEY = "devbox:favorites";
export const RECENT_KEY = "devbox:recent";
export const MAX_RECENT = 8;

/** Accept only an array of unique strings from untrusted storage. */
export function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) if (typeof item === "string" && item) seen.add(item);
  return [...seen];
}

/** Add the id if missing, remove it if present. New favorites go to the end. */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Move `id` to the front (most recent first), dedupe, cap at `max`. */
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Drop ids of tools that no longer exist, keeping order. */
export function keepKnown(list: readonly string[], knownIds: ReadonlySet<string>): string[] {
  return list.filter((id) => knownIds.has(id));
}

export interface ListStore {
  get(): readonly string[];
  update(fn: (list: readonly string[]) => string[]): void;
  subscribe(listener: () => void): () => void;
}

/**
 * Tiny observable list persisted in storage. `get()` returns a stable reference until the list
 * changes, so it works with `useSyncExternalStore`.
 */
export function createListStore(storage: KeyValueStorage | undefined, key: string): ListStore {
  const read = (): string[] => {
    try {
      const raw = storage?.getItem(key);
      return raw ? parseIdList(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  };

  let current: readonly string[] = read();
  const listeners = new Set<() => void>();

  return {
    get: () => current,
    update(fn) {
      const next = fn(current);
      if (next.length === current.length && next.every((id, i) => id === current[i])) return;
      current = next;
      try {
        storage?.setItem(key, JSON.stringify(next));
      } catch {
        // best effort
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
