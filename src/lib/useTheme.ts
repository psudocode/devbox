import { useCallback, useEffect, useState } from "react";
import {
  loadThemePreference,
  nextThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Apply the theme to <html>. Exported so `main.tsx` can call it before first render (no flash). */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function initTheme(): void {
  applyTheme(loadThemePreference(safeLocalStorage()));
}

const listeners = new Set<(pref: ThemePreference) => void>();

function notifyTheme(next: ThemePreference) {
  for (const listener of listeners) listener(next);
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference(safeLocalStorage()));
  const [resolved, setResolved] = useState<ResolvedTheme>(() => applyTheme(preference));

  useEffect(() => {
    listeners.add(setPreference);
    return () => {
      listeners.delete(setPreference);
    };
  }, []);

  useEffect(() => {
    setResolved(applyTheme(preference));
    if (preference !== "system") return;
    // Follow live system changes only while the user has not overridden.
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setResolved(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const cycle = useCallback(() => {
    const current = loadThemePreference(safeLocalStorage());
    const next = nextThemePreference(current);
    saveThemePreference(safeLocalStorage(), next);
    notifyTheme(next);
  }, []);

  return { preference, resolved, cycle };
}
