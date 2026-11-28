import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Budgets in bytes of minified (uncompressed) JS. */
export const BUDGETS = {
  /** Scripts that index.html loads up front: what every visitor downloads. */
  entry: 350 * 1024,
  /** Any single chunk, including lazy ones (largest today: vendor-terser, loaded on demand). */
  chunk: 560 * 1024,
};

/** Pure check: `chunks` is [{ name, size }], `entryNames` the file names index.html loads eagerly. */
export function checkBudget(chunks, entryNames, budgets = BUDGETS) {
  const errors = [];
  const entrySize = chunks.filter((c) => entryNames.includes(c.name)).reduce((n, c) => n + c.size, 0);
  if (entrySize > budgets.entry) errors.push(`entry JS ${entrySize} B exceeds budget ${budgets.entry} B`);
  for (const c of chunks) {
    if (c.size > budgets.chunk) errors.push(`chunk ${c.name} ${c.size} B exceeds budget ${budgets.chunk} B`);
  }
  return { entrySize, errors };
}

export function eagerScripts(html) {
  const names = new Set();
  for (const m of html.matchAll(/(?:src|href)="[^"]*?assets\/([^"/]+\.js)"/g)) names.add(m[1]);
  return [...names];
}

function main(dist = "dist") {
  const dir = join(dist, "assets");
  const chunks = readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((name) => ({ name, size: statSync(join(dir, name)).size }));
  const { entrySize, errors } = checkBudget(chunks, eagerScripts(readFileSync(join(dist, "index.html"), "utf8")));
  const biggest = [...chunks].sort((a, b) => b.size - a.size)[0];
  console.log(`bundle: entry ${entrySize} B, largest chunk ${biggest.name} ${biggest.size} B`);
  if (errors.length) {
    for (const e of errors) console.error(`BUDGET EXCEEDED: ${e}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
