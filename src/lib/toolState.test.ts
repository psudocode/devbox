import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./theme";
import {
  decodeState,
  encodeState,
  hasSameShape,
  loadToolState,
  resolveInitialState,
  saveToolState,
  toolStorageKey,
} from "./toolState";

const memoryStorage = (initial: Record<string, string> = {}): KeyValueStorage => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("encodeState / decodeState", () => {
  it("round-trips JSON values", () => {
    for (const value of [{ input: "hello", n: 1 }, [1, "a"], "text", 42, null, true]) {
      expect(decodeState(encodeState(value))).toEqual(value);
    }
  });

  it("round-trips unicode and emoji", () => {
    const value = { input: "héllo wörld — 日本語 🐙" };
    expect(decodeState(encodeState(value))).toEqual(value);
  });

  it("produces URL-safe output without padding", () => {
    const encoded = encodeState({ input: "??>>~~ subjects?_=/+" });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("handles large payloads", () => {
    const value = { input: "x".repeat(200_000) };
    expect(decodeState(encodeState(value))).toEqual(value);
  });

  it("returns undefined for malformed input instead of throwing", () => {
    expect(decodeState("")).toBeUndefined();
    expect(decodeState("not base64!")).toBeUndefined();
    expect(decodeState("AAAA")).toBeUndefined(); // valid base64, not JSON
    expect(decodeState("/+/+")).toBeUndefined(); // standard-alphabet chars are not accepted
    expect(decodeState("%%%")).toBeUndefined();
  });
});

describe("hasSameShape", () => {
  it("compares JSON kinds", () => {
    expect(hasSameShape("a", "")).toBe(true);
    expect(hasSameShape(1, "")).toBe(false);
    expect(hasSameShape(null, {})).toBe(false);
    expect(hasSameShape([], {})).toBe(false);
    expect(hasSameShape([], [])).toBe(true);
  });

  it("requires template keys on objects, tolerates extras", () => {
    const template = { input: "", indent: 2 };
    expect(hasSameShape({ input: "x", indent: 4 }, template)).toBe(true);
    expect(hasSameShape({ input: "x", indent: 4, extra: true }, template)).toBe(true);
    expect(hasSameShape({ input: "x" }, template)).toBe(false);
    expect(hasSameShape({ input: "x", indent: "4" }, template)).toBe(false);
  });
});

describe("tool storage", () => {
  it("saves and loads per tool id", () => {
    const storage = memoryStorage();
    saveToolState(storage, "a", { input: "1" });
    saveToolState(storage, "b", { input: "2" });
    expect(loadToolState(storage, "a")).toEqual({ input: "1" });
    expect(loadToolState(storage, "b")).toEqual({ input: "2" });
    expect(loadToolState(storage, "c")).toBeUndefined();
  });

  it("ignores corrupt JSON and missing storage", () => {
    expect(loadToolState(memoryStorage({ [toolStorageKey("a")]: "{oops" }), "a")).toBeUndefined();
    expect(loadToolState(undefined, "a")).toBeUndefined();
    expect(() => saveToolState(undefined, "a", 1)).not.toThrow();
  });
});

describe("resolveInitialState", () => {
  const defaults = { input: "" };

  it("prefers shared state, then saved state, then defaults", () => {
    const storage = memoryStorage();
    saveToolState(storage, "t", { input: "saved" });
    const shared = encodeState({ input: "shared" });

    expect(resolveInitialState("t", defaults, shared, storage)).toEqual({ input: "shared" });
    expect(resolveInitialState("t", defaults, undefined, storage)).toEqual({ input: "saved" });
    expect(resolveInitialState("t", defaults, undefined, memoryStorage())).toEqual(defaults);
  });

  it("ignores shared or saved state with the wrong shape", () => {
    const storage = memoryStorage();
    saveToolState(storage, "t", "wrong");
    expect(resolveInitialState("t", defaults, encodeState([1, 2]), storage)).toEqual(defaults);
    expect(resolveInitialState("t", defaults, "garbage!!", storage)).toEqual(defaults);
  });
});
