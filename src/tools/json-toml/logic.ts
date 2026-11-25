import { parse, stringify, TomlError } from "smol-toml";

/** JSON <-> TOML (TOML 1.0) on top of `smol-toml`. */

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string };

export interface JsonToTomlOptions {
  /** TOML has no null. Drop keys (and array items) that are null instead of failing. */
  dropNulls: boolean;
}

export interface TomlToJsonOptions {
  indent: 2 | 4 | "tab" | null;
  sortKeys: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

class NullFound extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

/** Remove nulls, or throw NullFound with the path of the first one. */
function handleNulls(value: unknown, drop: boolean, path: string): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    value.forEach((item, i) => {
      if (item === null) {
        if (!drop) throw new NullFound(`${path}[${i}]`);
        return;
      }
      out.push(handleNulls(item, drop, `${path}[${i}]`));
    });
    return out;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (child === null) {
        if (!drop) throw new NullFound(childPath);
        continue;
      }
      out[key] = handleNulls(child, drop, childPath);
    }
    return out;
  }
  return value;
}

/** JSON text -> TOML text. The JSON must be an object (TOML documents are tables). */
export function jsonToToml(json: string, { dropNulls }: JsonToTomlOptions): ConvertResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isPlainObject(value)) {
    return { ok: false, error: "TOML needs a JSON object at the top level (a document is a table of key/value pairs)." };
  }
  try {
    const clean = handleNulls(value, dropNulls, "") as Record<string, unknown>;
    return { ok: true, output: stringify(clean) };
  } catch (err) {
    if (err instanceof NullFound) {
      return {
        ok: false,
        error: `TOML has no null value (found at "${err.path}"). Turn on "Drop nulls" to leave these out.`,
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

/**
 * TOML text -> JSON text. Dates/times become ISO-like strings (offset, local date and local time are kept as written),
 * integers beyond 2^53 become strings so no digits are lost, `inf`/`nan` become the strings "Infinity" / "NaN".
 */
export function tomlToJson(toml: string, { indent, sortKeys }: TomlToJsonOptions): ConvertResult {
  try {
    let value: unknown = parse(toml, { integersAsBigInt: "asNeeded" });
    if (sortKeys) value = sortKeysDeep(value);
    const space = indent === null ? undefined : indent === "tab" ? "\t" : indent;
    return { ok: true, output: JSON.stringify(value, replacer, space) };
  } catch (err) {
    if (err instanceof TomlError) {
      const headline = err.message.split("\n")[0].replace(/^Invalid TOML document:\s*/, "");
      return { ok: false, error: `line ${err.line}, column ${err.column}: ${headline}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}
