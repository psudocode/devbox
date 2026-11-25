import { toGo, toTypeScript, toZod, type GoOptions, type Target, type TypeScriptOptions, type ZodOptions } from "./generate";
import { inferType, pascalCase } from "./infer";

export type { Target } from "./generate";

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string };

export interface GenerateOptions {
  target: Target;
  rootName: string;
  typescript: TypeScriptOptions;
  go: GoOptions;
  zod: ZodOptions;
}

/** Generate TypeScript types, Go structs or a Zod schema from a JSON sample. */
export function generateTypes(json: string, options: GenerateOptions): ConvertResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const rootName = pascalCase(options.rootName.trim() || "Root");
  const type = inferType(value);

  switch (options.target) {
    case "typescript":
      return { ok: true, output: toTypeScript(type, rootName, options.typescript) };
    case "go":
      return { ok: true, output: toGo(type, rootName, options.go) };
    case "zod":
      return { ok: true, output: toZod(type, rootName, options.zod) };
  }
}
