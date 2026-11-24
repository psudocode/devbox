import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

export const SW_FILENAME = "sw.js";
export const CACHE_PREFIX = "devbox-";
const HOST_CONTROL_FILES = new Set(["_headers", "_redirects", "_routes.json"]);

/** Recursively list files under `dir` as posix-style paths relative to it, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/** Stable short hash of file names + contents; changes whenever any precached file changes. */
export function hashFiles(dir: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Source of the service worker. Strategy:
 *  - install: precache every built file (so every lazy-loaded tool works offline)
 *  - navigation: network first, fall back to the cached index.html
 *  - other same-origin GET: cache first, then network (and cache the result)
 *  - activate: delete caches from older builds. No skipWaiting: a new version takes over once
 *    all tabs are closed, so a running page never loses the chunks it still needs.
 */
export function renderServiceWorker(cacheName: string, precache: string[]): string {
  return `// Generated at build time. Do not edit.
const CACHE_NAME = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};
const PRECACHE = ${JSON.stringify(precache)};
const scope = self.registration.scope;
const indexUrl = new URL("index.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, scope).href))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(indexUrl)));
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
`;
}

/** Vite plugin: after a production build, emit `sw.js` that precaches everything in `outDir`. */
export function serviceWorkerPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "devbox-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f !== SW_FILENAME && !HOST_CONTROL_FILES.has(f));
      const cacheName = `${CACHE_PREFIX}${hashFiles(outDir, files)}`;
      writeFileSync(join(outDir, SW_FILENAME), renderServiceWorker(cacheName, ["./", ...files]));
    },
  };
}
