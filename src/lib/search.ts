import type { ToolMeta } from "../tools/types";

const normalize = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

const tokenize = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Score one token against a tool. Higher is better, 0 means no match.
 *  name starts with token > word in name starts with token > name contains token
 *  > keyword > category > description
 */
function scoreToken(tool: ToolMeta, token: string): number {
  const name = normalize(tool.name);
  if (name.startsWith(token)) return 100;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(token))) return 80;
  if (name.includes(token)) return 60;
  if (tool.keywords?.some((k) => normalize(k).includes(token))) return 40;
  if (normalize(tool.category).includes(token)) return 20;
  if (normalize(tool.description).includes(token)) return 10;
  return 0;
}

/**
 * Search tools. Every whitespace-separated token must match (AND). Results are sorted by
 * total score, then by name. An empty query returns all tools sorted by name.
 */
export function searchTools<T extends ToolMeta>(tools: readonly T[], query: string): T[] {
  const tokens = tokenize(query);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  if (tokens.length === 0) return [...tools].sort(byName);

  const scored: { tool: T; score: number }[] = [];
  for (const tool of tools) {
    let total = 0;
    let matched = true;
    for (const token of tokens) {
      const s = scoreToken(tool, token);
      if (s === 0) {
        matched = false;
        break;
      }
      total += s;
    }
    if (matched) scored.push({ tool, score: total });
  }
  scored.sort((a, b) => b.score - a.score || byName(a.tool, b.tool));
  return scored.map((s) => s.tool);
}

/** Move a list selection by `delta`, wrapping around. Returns -1 for an empty list. */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  return (((index + delta) % length) + length) % length;
}
