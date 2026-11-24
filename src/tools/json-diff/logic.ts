import { formatError, parseJson, stringifyJson, type JsonNode } from "../json-formatter/logic";

export type ChangeType = "added" | "removed" | "changed";

export interface Change {
  /** JSONPath-style location, e.g. `$.users[0].name`. */
  path: string;
  type: ChangeType;
  /** Minified JSON of the value on the left (absent for "added"). */
  left?: string;
  /** Minified JSON of the value on the right (absent for "removed"). */
  right?: string;
}

export interface DiffOptions {
  /** Treat arrays as unordered collections (matches equal items regardless of position). */
  ignoreArrayOrder: boolean;
}

/**
 * Canonical form of a JSON number literal so that 1, 1.0, 1e0 and 10e-1 compare equal
 * without going through floating point (so 12345678901234567890 != 12345678901234567891).
 * -0 and 0 are considered equal.
 */
export function canonicalNumber(raw: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return raw;
  const [, sign, int, frac = "", exp = "0"] = match;
  let digits = int + frac;
  let exponent = Number(exp) - frac.length;
  digits = digits.replace(/^0+/, "");
  if (digits === "") return "0";
  const trimmed = digits.replace(/0+$/, "");
  exponent += digits.length - trimmed.length;
  return `${sign}${trimmed}e${exponent}`;
}

/** Order-insensitive-for-objects canonical string of a node (used for equality and array matching). */
function canon(node: JsonNode, ignoreArrayOrder: boolean): string {
  switch (node.type) {
    case "number":
      return canonicalNumber(node.raw);
    case "string":
      return JSON.stringify(JSON.parse(node.raw)); // decode escapes so "A" equals "A"
    case "literal":
      return node.raw;
    case "array": {
      const items = node.items.map((item) => canon(item, ignoreArrayOrder));
      if (ignoreArrayOrder) items.sort();
      return `[${items.join(",")}]`;
    }
    case "object": {
      const map = objectMap(node);
      return `{${[...map.keys()]
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canon(map.get(k)!, ignoreArrayOrder)}`)
        .join(",")}}`;
    }
  }
}

/** Key -> value. With duplicate keys the last one wins, like JSON.parse. Insertion order = first appearance. */
function objectMap(node: Extract<JsonNode, { type: "object" }>): Map<string, JsonNode> {
  const map = new Map<string, JsonNode>();
  for (const entry of node.entries) map.set(entry.key, entry.value);
  return map;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const childKeyPath = (path: string, key: string) =>
  IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const show = (node: JsonNode) => stringifyJson(node, { indent: null, sortKeys: false });

function diffNodes(left: JsonNode, right: JsonNode, path: string, opts: DiffOptions, out: Change[]): void {
  if (left.type === "object" && right.type === "object") {
    const l = objectMap(left);
    const r = objectMap(right);
    for (const [key, value] of l) {
      const other = r.get(key);
      const childPath = childKeyPath(path, key);
      if (other === undefined) out.push({ path: childPath, type: "removed", left: show(value) });
      else diffNodes(value, other, childPath, opts, out);
    }
    for (const [key, value] of r) {
      if (!l.has(key)) out.push({ path: childKeyPath(path, key), type: "added", right: show(value) });
    }
    return;
  }

  if (left.type === "array" && right.type === "array") {
    if (opts.ignoreArrayOrder) diffUnorderedArrays(left, right, path, out);
    else {
      const max = Math.max(left.items.length, right.items.length);
      for (let i = 0; i < max; i++) {
        const childPath = `${path}[${i}]`;
        if (i >= right.items.length) out.push({ path: childPath, type: "removed", left: show(left.items[i]) });
        else if (i >= left.items.length) out.push({ path: childPath, type: "added", right: show(right.items[i]) });
        else diffNodes(left.items[i], right.items[i], childPath, opts, out);
      }
    }
    return;
  }

  if (canon(left, opts.ignoreArrayOrder) !== canon(right, opts.ignoreArrayOrder)) {
    out.push({ path, type: "changed", left: show(left), right: show(right) });
  }
}

/** Unordered arrays: cancel out equal items; leftovers are removed/added. Positions refer to the original index. */
function diffUnorderedArrays(
  left: Extract<JsonNode, { type: "array" }>,
  right: Extract<JsonNode, { type: "array" }>,
  path: string,
  out: Change[],
): void {
  const pending = new Map<string, number[]>(); // canonical form -> unmatched right indexes
  right.items.forEach((item, i) => {
    const key = canon(item, true);
    pending.set(key, [...(pending.get(key) ?? []), i]);
  });
  const matchedRight = new Set<number>();
  left.items.forEach((item, i) => {
    const indexes = pending.get(canon(item, true));
    const match = indexes?.shift();
    if (match !== undefined) matchedRight.add(match);
    else out.push({ path: `${path}[${i}]`, type: "removed", left: show(item) });
  });
  right.items.forEach((item, i) => {
    if (!matchedRight.has(i)) out.push({ path: `${path}[${i}]`, type: "added", right: show(item) });
  });
}

export type DiffResult =
  | { ok: true; changes: Change[]; equal: boolean }
  | { ok: false; side: "left" | "right"; error: string };

/** Compare two JSON documents structurally. Key order never matters; array order matters unless asked. */
export function diffJson(leftText: string, rightText: string, options: DiffOptions): DiffResult {
  const left = parseJson(leftText);
  if (!left.ok) return { ok: false, side: "left", error: formatError(left.error) };
  const right = parseJson(rightText);
  if (!right.ok) return { ok: false, side: "right", error: formatError(right.error) };

  const changes: Change[] = [];
  diffNodes(left.value, right.value, "$", options, changes);
  return { ok: true, changes, equal: changes.length === 0 };
}

export function summarize(changes: readonly Change[]): Record<ChangeType, number> {
  const counts: Record<ChangeType, number> = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) counts[change.type]++;
  return counts;
}
