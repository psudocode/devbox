export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "devbox:theme";
export const THEME_ORDER: readonly ThemePreference[] = ["system", "light", "dark"];

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Cycle system -> light -> dark -> system. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
}

/** Minimal slice of `Storage` so tests can pass a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the saved preference. Never throws (storage can be blocked, e.g. private mode). */
export function loadThemePreference(storage: KeyValueStorage | undefined): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function saveThemePreference(storage: KeyValueStorage | undefined, preference: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // ignore: preference just won't persist
  }
}
