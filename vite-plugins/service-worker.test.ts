import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashFiles, listFiles, renderServiceWorker } from "./service-worker";

const SCOPE = "https://example.test/devbox/";

type Listener = (event: Record<string, unknown>) => void;

/** Run the generated worker in a sandbox with a fake service worker global scope. */
function loadWorker(cacheName: string, precache: string[], cacheEntries: Record<string, string> = {}) {
  const listeners: Record<string, Listener> = {};
  const cache = {
    addAll: vi.fn(async () => undefined),
    put: vi.fn(async () => undefined),
  };
  const store = new Map(Object.entries(cacheEntries));
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["devbox-old", "devbox-new", "unrelated-cache"]),
    delete: vi.fn(async () => true),
    match: vi.fn(async (req: string | { url: string }) => store.get(typeof req === "string" ? req : req.url)),
  };
  const fetchMock = vi.fn();
  const self = {
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
  };
  vm.runInNewContext(renderServiceWorker(cacheName, precache), { self, caches, fetch: fetchMock, URL, JSON, Promise });
  return { listeners, cache, caches, fetchMock };
}

const run = async (listener: Listener, event: Record<string, unknown> = {}) => {
  let pending: Promise<unknown> | undefined;
  let response: Promise<unknown> | undefined;
  listener({
    ...event,
    waitUntil: (p: Promise<unknown>) => void (pending = p),
    respondWith: (p: Promise<unknown>) => void (response = p),
  });
  await pending;
  return response;
};

describe("renderServiceWorker", () => {
  it("produces valid JavaScript", () => {
    expect(() => new vm.Script(renderServiceWorker("devbox-abc", ["./"]))).not.toThrow();
  });

  it("embeds the cache name and precache list safely", () => {
    const source = renderServiceWorker('devbox-"x"', ["./", "assets/a b.js"]);
    expect(source).toContain(JSON.stringify('devbox-"x"'));
    expect(source).toContain(JSON.stringify(["./", "assets/a b.js"]));
  });

  it("precaches resolved URLs on install", async () => {
    const { listeners, cache } = loadWorker("devbox-1", ["./", "assets/app.js"]);
    await run(listeners.install);
    expect(cache.addAll).toHaveBeenCalledWith([SCOPE, `${SCOPE}assets/app.js`]);
  });

  it("deletes only older devbox caches on activate", async () => {
    const { listeners, caches } = loadWorker("devbox-new", []);
    await run(listeners.activate);
    expect(caches.delete).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledWith("devbox-old");
  });

  it("serves the cached index.html when a navigation fails offline", async () => {
    const { listeners, fetchMock } = loadWorker("devbox-1", [], { [`${SCOPE}index.html`]: "cached-index" });
    fetchMock.mockRejectedValue(new Error("offline"));
    const result = await run(listeners.fetch, {
      request: { method: "GET", mode: "navigate", url: `${SCOPE}#/json` },
    });
    expect(result).toBe("cached-index");
  });

  it("serves assets from cache first, without touching the network", async () => {
    const url = `${SCOPE}assets/app.js`;
    const { listeners, fetchMock } = loadWorker("devbox-1", [], { [url]: "cached-asset" });
    const result = await run(listeners.fetch, { request: { method: "GET", mode: "cors", url } });
    expect(result).toBe("cached-asset");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and caches assets that are not cached yet", async () => {
    const url = `${SCOPE}assets/new.js`;
    const { listeners, fetchMock, cache } = loadWorker("devbox-1", []);
    const response = { ok: true, clone: () => "copy" };
    fetchMock.mockResolvedValue(response);
    const request = { method: "GET", mode: "cors", url };
    expect(await run(listeners.fetch, { request })).toBe(response);
    await Promise.resolve();
    expect(cache.put).toHaveBeenCalledWith(request, "copy");
  });

  it("ignores non-GET and cross-origin requests", async () => {
    const { listeners } = loadWorker("devbox-1", []);
    expect(await run(listeners.fetch, { request: { method: "POST", mode: "cors", url: `${SCOPE}x` } })).toBeUndefined();
    expect(await run(listeners.fetch, { request: { method: "GET", mode: "cors", url: "https://other.test/x" } })).toBeUndefined();
  });
});

describe("build output helpers", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const makeDist = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "devbox-sw-"));
    dirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dir, name, ".."), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    return dir;
  };

  it("lists nested files with posix paths, sorted", () => {
    const dir = makeDist({ "index.html": "", "assets/b.js": "", "assets/a.css": "" });
    expect(listFiles(dir)).toEqual(["assets/a.css", "assets/b.js", "index.html"]);
  });

  it("hash changes with content and is stable otherwise", () => {
    const one = makeDist({ "a.js": "1" });
    const same = makeDist({ "a.js": "1" });
    const changed = makeDist({ "a.js": "2" });
    expect(hashFiles(one, ["a.js"])).toBe(hashFiles(same, ["a.js"]));
    expect(hashFiles(one, ["a.js"])).not.toBe(hashFiles(changed, ["a.js"]));
    expect(hashFiles(one, ["a.js"])).toMatch(/^[0-9a-f]{12}$/);
  });
});
