import { nameObjects, splitNullable, words, type JsonType } from "./infer";

export type Target = "typescript" | "go" | "zod";

export interface TypeScriptOptions {
  style: "interface" | "type";
  exportTypes: boolean;
  readonly: boolean;
}

export interface GoOptions {
  /** Add `omitempty` to optional fields. */
  omitempty: boolean;
}

export interface ZodOptions {
  /** Also emit `export type X = z.infer<typeof XSchema>`. */
  inferTypes: boolean;
  exportSchemas: boolean;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const quoteKey = (key: string) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

// ---------------------------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------------------------

export function toTypeScript(root: JsonType, rootName: string, options: TypeScriptOptions): string {
  const named = nameObjects(root, rootName);
  const exp = options.exportTypes ? "export " : "";
  const ro = options.readonly ? "readonly " : "";

  const render = (t: JsonType): string => {
    switch (t.k) {
      case "string":
        return "string";
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "unknown":
        return "unknown";
      case "array": {
        const inner = render(t.item);
        return /[|&]/.test(inner) ? `${options.readonly ? "readonly " : ""}(${inner})[]` : `${options.readonly ? "readonly " : ""}${inner}[]`;
      }
      case "object":
        return t.name ?? "Record<string, unknown>";
      case "union":
        return t.types.map(render).join(" | ");
    }
  };

  const blocks: string[] = [];
  if (root.k !== "object") {
    // Arrays and scalars at the top level: alias the root.
    blocks.push(`${exp}type ${rootName} = ${render(root)};`);
  }
  for (const obj of named) {
    const body = obj.fields.map((f) => `  ${ro}${quoteKey(f.key)}${f.optional ? "?" : ""}: ${render(f.type)};`);
    if (options.style === "interface") {
      blocks.push(body.length ? `${exp}interface ${obj.name} {\n${body.join("\n")}\n}` : `${exp}interface ${obj.name} {}`);
    } else {
      blocks.push(body.length ? `${exp}type ${obj.name} = {\n${body.join("\n")}\n};` : `${exp}type ${obj.name} = Record<string, never>;`);
    }
  }
  return blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------------------------

const INITIALISMS = new Set([
  "id", "url", "uri", "api", "http", "https", "json", "xml", "html", "sql", "uuid", "ip", "ui", "uid",
  "ssh", "tls", "ssl", "cpu", "gpu", "ram", "os", "dns", "tcp", "udp", "eof", "acl", "ascii", "css",
  "guid", "rpc", "ttl", "vm", "xsrf", "xss", "utf8", "smtp", "sla", "qps", "lhs", "rhs",
]);

/** Exported Go field name: "user_id" -> "UserID", "createdAt" -> "CreatedAt". */
export function goFieldName(key: string): string {
  const name = words(key)
    .map((w) => (INITIALISMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  if (name === "") return "Field";
  return /^\d/.test(name) ? `F${name}` : name;
}

const isNilable = (goType: string) => goType === "any" || goType.startsWith("[]") || goType.startsWith("map[") || goType.startsWith("*");

export function toGo(root: JsonType, rootName: string, options: GoOptions): string {
  const named = nameObjects(root, rootName);

  /** Go type for a value, without pointer handling. */
  const render = (t: JsonType): string => {
    switch (t.k) {
      case "string":
        return "string";
      case "number":
        return t.int ? "int64" : "float64";
      case "boolean":
        return "bool";
      case "null":
      case "unknown":
        return "any";
      case "array":
        return `[]${render(t.item)}`;
      case "object":
        return t.name ?? "map[string]any";
      case "union": {
        const { type: inner, nullable } = splitNullable(t);
        if (inner === null || inner.k === "union") return "any";
        const base = render(inner);
        return nullable && !isNilable(base) ? `*${base}` : base;
      }
    }
  };

  const fieldType = (type: JsonType, optional: boolean): { goType: string; omit: boolean } => {
    const { type: inner, nullable } = splitNullable(type);
    if (inner === null) return { goType: "any", omit: optional };
    const base = render(inner);
    // Slices, maps and interfaces already have a nil value; scalars and structs need a pointer to tell "absent" from zero.
    const pointer = (optional || nullable) && !isNilable(base);
    return { goType: pointer ? `*${base}` : base, omit: optional };
  };

  const blocks: string[] = [];
  if (root.k !== "object") blocks.push(`type ${rootName} ${render(root)}`);

  for (const obj of named) {
    const used = new Set<string>();
    const rows = obj.fields.map((f) => {
      let name = goFieldName(f.key);
      for (let i = 2; used.has(name); i++) name = `${goFieldName(f.key)}${i}`;
      used.add(name);
      const { goType, omit } = fieldType(f.type, f.optional);
      const tag = `json:"${f.key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}${omit && options.omitempty ? ",omitempty" : ""}"`;
      return { name, goType, tag: `\`${tag}\`` };
    });
    const nameWidth = Math.max(0, ...rows.map((r) => r.name.length));
    const typeWidth = Math.max(0, ...rows.map((r) => r.goType.length));
    const body = rows.map((r) => `\t${r.name.padEnd(nameWidth)} ${r.goType.padEnd(typeWidth)} ${r.tag}`);
    blocks.push(rows.length ? `type ${obj.name} struct {\n${body.join("\n")}\n}` : `type ${obj.name} struct{}`);
  }
  return blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------------------------

export function toZod(root: JsonType, rootName: string, options: ZodOptions): string {
  const named = nameObjects(root, rootName);
  const exp = options.exportSchemas ? "export " : "";
  const schemaName = (name: string) => `${name}Schema`;

  const render = (t: JsonType): string => {
    switch (t.k) {
      case "string":
        return "z.string()";
      case "number":
        return t.int ? "z.number().int()" : "z.number()";
      case "boolean":
        return "z.boolean()";
      case "null":
        return "z.null()";
      case "unknown":
        return "z.unknown()";
      case "array":
        return `z.array(${render(t.item)})`;
      case "object":
        return t.name ? schemaName(t.name) : "z.record(z.string(), z.unknown())";
      case "union": {
        const { type: inner, nullable } = splitNullable(t);
        if (inner === null) return "z.null()";
        const base = inner.k === "union" ? `z.union([${inner.types.map(render).join(", ")}])` : render(inner);
        return nullable ? `${base}.nullable()` : base;
      }
    }
  };

  // Schemas are `const`s, so dependencies must come first: children before parents.
  const ordered = [...named].reverse();
  const blocks: string[] = ['import { z } from "zod";'];

  for (const obj of ordered) {
    const body = obj.fields.map((f) => `  ${quoteKey(f.key)}: ${render(f.type)}${f.optional ? ".optional()" : ""},`);
    blocks.push(
      body.length
        ? `${exp}const ${schemaName(obj.name!)} = z.object({\n${body.join("\n")}\n});`
        : `${exp}const ${schemaName(obj.name!)} = z.object({});`,
    );
  }
  if (root.k !== "object") blocks.push(`${exp}const ${schemaName(rootName)} = ${render(root)};`);

  if (options.inferTypes) {
    const typeNames = [...ordered.map((o) => o.name!), ...(root.k !== "object" ? [rootName] : [])];
    blocks.push(typeNames.map((n) => `${exp}type ${n} = z.infer<typeof ${schemaName(n)}>;`).join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}
