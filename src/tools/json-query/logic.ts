import { JqError, runJq } from "./jq";
import { evaluateJsonPath, JsonPathError } from "./jsonpath";

export type Engine = "jsonpath" | "jq";

export interface QueryOptions {
  engine: Engine;
  query: string;
  /** JSONPath only: show the matched values, the normalized paths, or both. */
  output: "values" | "paths" | "both";
  /** jq only: print strings without quotes (like `jq -r`). */
  raw: boolean;
  /** JSON indent for the output; null = compact. */
  indent: 2 | 4 | "tab" | null;
}

/** Stop formatting results beyond this many characters; a textarea cannot usefully show more. */
export const MAX_OUTPUT_CHARS = 5_000_000;

export type QueryResult = { ok: true; output: string; count: number } | { ok: false; error: string };

/** Run a JSONPath or jq-style query against JSON text. */
export function runQuery(json: string, options: QueryOptions): QueryResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON input: ${err instanceof Error ? err.message : String(err)}` };
  }
  const query = options.query.trim();
  if (query === "") return { ok: false, error: "Enter a query." };

  const space = options.indent === null ? undefined : options.indent === "tab" ? "\t" : options.indent;
  const fmt = (v: unknown) => JSON.stringify(v, null, space) ?? "null";

  try {
    if (options.engine === "jsonpath") {
      const nodes = evaluateJsonPath(data, query);
      let output: string;
      if (options.output === "paths") output = fmt(nodes.map((n) => n.path));
      else if (options.output === "both") output = fmt(nodes.map((n) => ({ path: n.path, value: n.value })));
      else output = fmt(nodes.map((n) => n.value));
      return { ok: true, output, count: nodes.length };
    }
    const results = runJq(data, query);
    const lines: string[] = [];
    let size = 0;
    for (const v of results) {
      const line = options.raw && typeof v === "string" ? v : fmt(v);
      size += line.length + 1;
      if (size > MAX_OUTPUT_CHARS) {
        return { ok: false, error: `The output is larger than ${MAX_OUTPUT_CHARS / 1_000_000} MB; narrow the query down.` };
      }
      lines.push(line);
    }
    return { ok: true, output: lines.join("\n"), count: results.length };
  } catch (err) {
    if (err instanceof JsonPathError || err instanceof JqError) return { ok: false, error: err.message };
    if (err instanceof RangeError) return { ok: false, error: "The query or the data is nested too deeply." };
    throw err;
  }
}
