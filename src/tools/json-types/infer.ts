/**
 * Infer a type model from JSON sample data, shared by the TypeScript / Go / Zod generators.
 * Array items and repeated objects are merged: fields missing in some samples become optional,
 * differing types become unions, null makes a type nullable.
 */

export type JsonType =
  | { k: "string" }
  | { k: "number"; int: boolean }
  | { k: "boolean" }
  | { k: "null" }
  /** Unknown content, e.g. the item type of an empty array. */
  | { k: "unknown" }
  | { k: "array"; item: JsonType }
  | { k: "object"; fields: Field[]; name?: string }
  | { k: "union"; types: JsonType[] };

export interface Field {
  key: string;
  type: JsonType;
  optional: boolean;
}

export const MAX_DEPTH = 200;

export function inferType(value: unknown, depth = 0): JsonType {
  if (depth > MAX_DEPTH) return { k: "unknown" };
  if (value === null) return { k: "null" };
  if (typeof value === "string") return { k: "string" };
  if (typeof value === "boolean") return { k: "boolean" };
  if (typeof value === "number") return { k: "number", int: Number.isInteger(value) };
  if (Array.isArray(value)) {
    let item: JsonType = { k: "unknown" };
    let first = true;
    for (const element of value) {
      const t = inferType(element, depth + 1);
      item = first ? t : mergeTypes(item, t);
      first = false;
    }
    return { k: "array", item };
  }
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value).map(([key, v]) => ({
      key,
      type: inferType(v, depth + 1),
      optional: false,
    }));
    return { k: "object", fields };
  }
  return { k: "unknown" };
}

const members = (t: JsonType): JsonType[] => (t.k === "union" ? t.types : [t]);

/** Merge two inferred types into one that accepts both. */
export function mergeTypes(a: JsonType, b: JsonType): JsonType {
  if (a.k === "unknown") return b;
  if (b.k === "unknown") return a;

  const result: JsonType[] = [];
  for (const t of [...members(a), ...members(b)]) {
    const index = result.findIndex((r) => r.k === t.k);
    if (index === -1) {
      result.push(t);
      continue;
    }
    const r = result[index];
    if (r.k === "number" && t.k === "number") {
      result[index] = { k: "number", int: r.int && t.int };
    } else if (r.k === "array" && t.k === "array") {
      result[index] = { k: "array", item: mergeTypes(r.item, t.item) };
    } else if (r.k === "object" && t.k === "object") {
      result[index] = mergeObjects(r, t);
    }
    // identical primitive kinds: nothing to do
  }
  return result.length === 1 ? result[0] : { k: "union", types: result };
}

function mergeObjects(
  a: Extract<JsonType, { k: "object" }>,
  b: Extract<JsonType, { k: "object" }>,
): JsonType {
  const fields: Field[] = a.fields.map((f) => ({ ...f }));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const keysInB = new Set(b.fields.map((f) => f.key));

  for (const f of fields) if (!keysInB.has(f.key)) f.optional = true;
  for (const f of b.fields) {
    const existing = byKey.get(f.key);
    if (existing) {
      existing.type = mergeTypes(existing.type, f.type);
      existing.optional = existing.optional || f.optional;
    } else {
      const added = { ...f, optional: true };
      fields.push(added);
      byKey.set(f.key, added);
    }
  }
  return { k: "object", fields };
}

/** Split `a union` into its non-null part and whether null was allowed. */
export function splitNullable(t: JsonType): { type: JsonType | null; nullable: boolean } {
  if (t.k === "null") return { type: null, nullable: true };
  if (t.k !== "union") return { type: t, nullable: false };
  const rest = t.types.filter((m) => m.k !== "null");
  const nullable = rest.length !== t.types.length;
  if (rest.length === 0) return { type: null, nullable };
  return { type: rest.length === 1 ? rest[0] : { k: "union", types: rest }, nullable };
}

// ---------------------------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------------------------

export type ObjectType = Extract<JsonType, { k: "object" }>;

/** Words of an identifier-ish string: "userID" -> [user, ID], "user_profile" -> [user, profile]. */
export function words(text: string): string[] {
  return text.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g) ?? [];
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** PascalCase type name: "user_profile" -> "UserProfile". Never empty, never starts with a digit. */
export function pascalCase(text: string): string {
  const name = words(text).map(capitalize).join("");
  if (name === "") return "Item";
  return /^\d/.test(name) ? `T${name}` : name;
}

/** Crude singular for array item names: "users" -> "User", "categories" -> "Category", "data" -> "DataItem". */
export function singular(text: string): string {
  const parts = words(text);
  const last = parts.pop();
  if (last === undefined) return "Item";
  let word = last;
  if (/ies$/i.test(word) && word.length > 3) word = word.slice(0, -3) + "y";
  else if (/(ss|us|is)$/i.test(word)) word = `${word}Item`;
  else if (/(ches|shes|xes|ses)$/i.test(word) && word.length > 4) word = word.slice(0, -2);
  else if (/s$/i.test(word) && word.length > 1) word = word.slice(0, -1);
  else word = `${word}Item`;
  return pascalCase([...parts, word].join("_"));
}

function signature(t: JsonType): string {
  switch (t.k) {
    case "number":
      return t.int ? "int" : "number";
    case "array":
      return `[${signature(t.item)}]`;
    case "object":
      return `{${t.fields.map((f) => `${JSON.stringify(f.key)}${f.optional ? "?" : ""}:${signature(f.type)}`).join(",")}}`;
    case "union":
      return `(${t.types.map(signature).sort().join("|")})`;
    default:
      return t.k;
  }
}

/**
 * Give every object node a unique PascalCase `name` (root first, then children in order).
 * Returns the named objects in that order. Structurally identical objects with the same name share one entry.
 */
export function nameObjects(root: JsonType, rootName: string): ObjectType[] {
  const named: ObjectType[] = [];
  const bySignature = new Map<string, ObjectType>();
  const taken = new Set<string>();

  const assign = (node: ObjectType, hint: string) => {
    const sig = signature(node);
    const base = pascalCase(hint);
    for (let i = 1; ; i++) {
      const candidate = i === 1 ? base : `${base}${i}`;
      const existing = bySignature.get(`${candidate}:${sig}`);
      if (existing) {
        node.name = existing.name;
        return false;
      }
      if (!taken.has(candidate)) {
        node.name = candidate;
        taken.add(candidate);
        bySignature.set(`${candidate}:${sig}`, node);
        named.push(node);
        return true;
      }
    }
  };

  const visit = (t: JsonType, hint: string) => {
    if (t.k === "array") visit(t.item, `${singular(hint)}`);
    else if (t.k === "union") t.types.forEach((m) => visit(m, hint));
    else if (t.k === "object") {
      if (!assign(t, hint)) return;
      for (const f of t.fields) visit(f.type, f.key);
    }
  };

  // Arrays directly under the root get "<Root>Item" instead of singular(<Root>).
  if (root.k === "array") visit(root.item, `${rootName}Item`);
  else visit(root, rootName);
  return named;
}
