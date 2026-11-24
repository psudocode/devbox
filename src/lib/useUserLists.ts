import { useCallback, useSyncExternalStore } from "react";
import { FAVORITES_KEY, RECENT_KEY, createListStore, keepKnown, pushRecent, toggleId } from "./userLists";
import { registry } from "../tools/registry";

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const favoritesStore = createListStore(safeLocalStorage(), FAVORITES_KEY);
const recentStore = createListStore(safeLocalStorage(), RECENT_KEY);

const knownIds = () => new Set(registry.tools.map((t) => t.id));

export function useFavorites() {
  const list = useSyncExternalStore(favoritesStore.subscribe, favoritesStore.get);
  const toggle = useCallback((id: string) => favoritesStore.update((l) => toggleId(l, id)), []);
  return { favorites: keepKnown(list, knownIds()), toggle };
}

export function useRecent() {
  return keepKnown(useSyncExternalStore(recentStore.subscribe, recentStore.get), knownIds());
}

/** Record that a tool was opened. No-op for unknown ids. */
export function markRecent(id: string) {
  if (knownIds().has(id)) recentStore.update((l) => pushRecent(l, id));
}
