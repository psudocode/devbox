import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "./theme";
import { createListStore, keepKnown, parseIdList, pushRecent, toggleId } from "./userLists";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  const storage: KeyValueStorage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  return { storage, data };
};

describe("parseIdList", () => {
  it("keeps unique non-empty strings only", () => {
    expect(parseIdList(["a", "b", "a", "", 3, null, "c"])).toEqual(["a", "b", "c"]);
    expect(parseIdList("nope")).toEqual([]);
    expect(parseIdList({})).toEqual([]);
  });
});

describe("toggleId", () => {
  it("adds then removes", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("pushRecent", () => {
  it("puts the newest first and dedupes", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "x")).toEqual(["x"]);
  });

  it("caps the list", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("keepKnown", () => {
  it("drops unknown ids and keeps order", () => {
    expect(keepKnown(["a", "gone", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("createListStore", () => {
  it("loads from storage and ignores corrupt data", () => {
    expect(createListStore(memoryStorage({ k: '["a","b"]' }).storage, "k").get()).toEqual(["a", "b"]);
    expect(createListStore(memoryStorage({ k: "{oops" }).storage, "k").get()).toEqual([]);
    expect(createListStore(memoryStorage({ k: '{"a":1}' }).storage, "k").get()).toEqual([]);
    expect(createListStore(undefined, "k").get()).toEqual([]);
  });

  it("persists updates and notifies subscribers", () => {
    const { storage, data } = memoryStorage();
    const store = createListStore(storage, "k");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.update((l) => toggleId(l, "a"));
    expect(store.get()).toEqual(["a"]);
    expect(data.k).toBe('["a"]');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.update((l) => toggleId(l, "b"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a stable reference and skips notifications when nothing changed", () => {
    const store = createListStore(memoryStorage().storage, "k");
    store.update(() => ["a"]);
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.update((l) => [...l]);
    expect(store.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});
