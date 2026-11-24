import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  loadThemePreference,
  nextThemePreference,
  parseThemePreference,
  resolveTheme,
  saveThemePreference,
  type KeyValueStorage,
} from "./theme";

const memoryStorage = (initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("parseThemePreference", () => {
  it("accepts valid values and falls back to system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("purple")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the system when preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets the user override the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("nextThemePreference", () => {
  it("cycles system -> light -> dark -> system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});

describe("storage", () => {
  it("round-trips the preference", () => {
    const storage = memoryStorage();
    saveThemePreference(storage, "dark");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("dark");
    expect(loadThemePreference(storage)).toBe("dark");
  });

  it("defaults to system for missing or corrupt values", () => {
    expect(loadThemePreference(memoryStorage())).toBe("system");
    expect(loadThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: "garbage" }))).toBe("system");
  });

  it("never throws when storage is unavailable", () => {
    expect(loadThemePreference(undefined)).toBe("system");
    expect(loadThemePreference(throwingStorage)).toBe("system");
    expect(() => saveThemePreference(throwingStorage, "light")).not.toThrow();
    expect(() => saveThemePreference(undefined, "light")).not.toThrow();
  });
});
