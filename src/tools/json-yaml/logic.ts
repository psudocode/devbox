import { parseAllDocuments, stringify, YAMLParseError } from "yaml";

export type Indent = 2 | 4;

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string };

export interface JsonToYamlOptions {
  indent: Indent;
  sortKeys: boolean;
}

export interface YamlToJsonOptions {
  indent: Indent | "tab" | null;
  sortKeys: boolean;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** JSON text -> YAML text. */
export function jsonToYaml(json: string, { indent, sortKeys }: JsonToYamlOptions): ConvertResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${errorMessage(err)}` };
  }
  try {
    return { ok: true, output: stringify(value, { indent, sortMapEntries: sortKeys, lineWidth: 0 }) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * YAML text -> JSON text. Multi-document YAML (`---`) becomes a JSON array.
 * Anchors/aliases and merge keys are resolved. Fails on syntax errors with line/column.
 */
export function yamlToJson(yaml: string, { indent, sortKeys }: YamlToJsonOptions): ConvertResult {
  let docs;
  try {
    docs = parseAllDocuments(yaml, { merge: true });
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  const list = Array.isArray(docs) ? docs : [docs];

  for (const doc of list) {
    const problem = doc.errors[0];
    if (problem) return { ok: false, error: formatYamlError(problem) };
  }

  try {
    const values = list.map((doc) => doc.toJS({ maxAliasCount: 1000 }) as unknown);
    let value: unknown = values.length === 0 ? null : values.length === 1 ? values[0] : values;
    if (value === undefined) value = null;
    if (sortKeys) value = sortKeysDeep(value);
    const space = indent === null ? undefined : indent === "tab" ? "\t" : indent;
    return { ok: true, output: JSON.stringify(value, jsonReplacer, space) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** YAML can hold values JSON cannot (Map keys, NaN, Infinity, bigint, dates); make them JSON-safe. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), v]));
  if (value instanceof Set) return [...value];
  return value;
}

export function formatYamlError(err: YAMLParseError): string {
  const pos = err.linePos?.[0];
  const where = pos ? `line ${pos.line}, column ${pos.col}: ` : "";
  // `yaml` appends a code frame after the first line of the message; keep only the headline.
  const headline = err.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "");
  return `${where}${headline}`;
}
