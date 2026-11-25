import { describe, expect, it } from "vitest";
import { goFieldName } from "./generate";
import { inferType, mergeTypes, nameObjects, pascalCase, singular, splitNullable, words } from "./infer";
import { generateTypes, type GenerateOptions, type Target } from "./logic";

const base: GenerateOptions = {
  target: "typescript",
  rootName: "Root",
  typescript: { style: "interface", exportTypes: false, readonly: false },
  go: { omitempty: true },
  zod: { inferTypes: false, exportSchemas: false },
};

function gen(json: string, target: Target, patch: Partial<GenerateOptions> = {}): string {
  const result = generateTypes(json, { ...base, target, ...patch });
  if (!result.ok) throw new Error(result.error);
  return result.output;
}

describe("naming helpers", () => {
  it("splits words and builds PascalCase", () => {
    expect(words("userID")).toEqual(["user", "ID"]);
    expect(words("HTTPServer")).toEqual(["HTTP", "Server"]);
    expect(words("user_profile-v2")).toEqual(["user", "profile", "v", "2"]);
    expect(pascalCase("user_profile")).toBe("UserProfile");
    expect(pascalCase("123abc")).toBe("T123Abc");
    expect(pascalCase("***")).toBe("Item");
  });

  it("singularizes array names", () => {
    expect(singular("users")).toBe("User");
    expect(singular("categories")).toBe("Category");
    expect(singular("boxes")).toBe("Box");
    expect(singular("address")).toBe("AddressItem");
    expect(singular("data")).toBe("DataItem");
    expect(singular("order_items")).toBe("OrderItem");
  });

  it("builds Go field names with initialisms", () => {
    expect(goFieldName("user_id")).toBe("UserID");
    expect(goFieldName("createdAt")).toBe("CreatedAt");
    expect(goFieldName("api_url")).toBe("APIURL");
    expect(goFieldName("2fa")).toBe("F2Fa");
    expect(goFieldName("---")).toBe("Field");
  });
});

describe("inference", () => {
  it("merges array items: optional fields, unions, int vs float", () => {
    const t = inferType([{ a: 1, b: "x" }, { a: 1.5, c: true }, { a: 2, b: null }]);
    expect(t.k).toBe("array");
    if (t.k !== "array" || t.item.k !== "object") throw new Error("expected array of objects");
    const fields = Object.fromEntries(t.item.fields.map((f) => [f.key, f]));
    expect(fields.a).toMatchObject({ optional: false, type: { k: "number", int: false } });
    // b is missing from the second sample, so it is optional; and null in the third makes it nullable.
    expect(fields.b.optional).toBe(true);
    expect(fields.b.type).toEqual({ k: "union", types: [{ k: "string" }, { k: "null" }] });
    expect(fields.c).toMatchObject({ optional: true, type: { k: "boolean" } });
  });

  it("treats empty arrays as unknown items and lets later items refine them", () => {
    expect(inferType([])).toEqual({ k: "array", item: { k: "unknown" } });
    expect(mergeTypes(inferType([]), inferType(["a"]))).toEqual({ k: "array", item: { k: "string" } });
  });

  it("splits nullable unions", () => {
    expect(splitNullable({ k: "union", types: [{ k: "string" }, { k: "null" }] })).toEqual({
      type: { k: "string" },
      nullable: true,
    });
    expect(splitNullable({ k: "null" })).toEqual({ type: null, nullable: true });
    expect(splitNullable({ k: "string" })).toEqual({ type: { k: "string" }, nullable: false });
  });

  it("names objects uniquely, reusing identical structures", () => {
    const t = inferType({ home: { street: "a" }, work: { street: "b" }, users: [{ id: 1 }], other: { users: [{ name: "x" }] } });
    const names = nameObjects(t, "Root").map((o) => o.name);
    expect(names).toEqual(["Root", "Home", "Work", "User", "Other", "User2"]);

    const same = inferType({ a: { users: [{ id: 1 }] }, b: { users: [{ id: 2 }] } });
    expect(nameObjects(same, "Root").map((o) => o.name)).toEqual(["Root", "A", "User", "B"]);
  });
});

describe("TypeScript output", () => {
  const sample = '{"id":1,"name":"Ann","tags":["a","b"],"address":{"city":"X","zip":null},"orders":[{"sku":"a","qty":1},{"sku":"b"}]}';

  it("generates interfaces with nested types and optional fields", () => {
    expect(gen(sample, "typescript")).toBe(
      `interface Root {
  id: number;
  name: string;
  tags: string[];
  address: Address;
  orders: Order[];
}

interface Address {
  city: string;
  zip: null;
}

interface Order {
  sku: string;
  qty?: number;
}
`,
    );
  });

  it("supports type aliases, export and readonly", () => {
    const out = gen('{"a":[1],"b":1}', "typescript", {
      typescript: { style: "type", exportTypes: true, readonly: true },
    });
    expect(out).toBe("export type Root = {\n  readonly a: readonly number[];\n  readonly b: number;\n};\n");
  });

  it("handles unions, nullable fields and quoted keys", () => {
    const out = gen('[{"a-b":1,"v":"x"},{"a-b":2,"v":3}]', "typescript");
    expect(out).toContain("type Root = RootItem[];");
    expect(out).toContain('"a-b": number;');
    expect(out).toContain("v: string | number;");
    expect(gen('{"a":[1,"x"]}', "typescript")).toContain("a: (number | string)[];");
    expect(gen('{"a":[]}', "typescript")).toContain("a: unknown[];");
  });

  it("handles scalar and empty roots, and custom root names", () => {
    expect(gen("5", "typescript")).toBe("type Root = number;\n");
    expect(gen("{}", "typescript", { rootName: "api response" })).toBe("interface ApiResponse {}\n");
  });
});

describe("Go output", () => {
  it("generates structs with json tags, int64/float64 and pointers for optional/null", () => {
    const out = gen(
      '{"user_id":1,"price":9.5,"ok":true,"name":"x","tags":["a"],"meta":{"k":"v"},"items":[{"a":1,"b":"x"},{"a":2,"b":null}],"opt":[{"x":1},{"y":2}]}',
      "go",
    );
    expect(out).toContain("type Root struct {");
    expect(out).toMatch(/UserID\s+int64\s+`json:"user_id"`/);
    expect(out).toMatch(/Price\s+float64\s+`json:"price"`/);
    expect(out).toMatch(/Tags\s+\[\]string\s+`json:"tags"`/);
    expect(out).toMatch(/Meta\s+Meta\s+`json:"meta"`/);
    expect(out).toMatch(/Items\s+\[\]Item\s+`json:"items"`/);
    expect(out).toContain("type Item struct {");
    // null in one sample -> pointer without omitempty; missing in one sample -> pointer with omitempty
    expect(out).toMatch(/B\s+\*string\s+`json:"b"`/);
    expect(out).toMatch(/X\s+\*int64\s+`json:"x,omitempty"`/);
  });

  it("can skip omitempty and keeps slices and any un-pointered", () => {
    const out = gen('[{"a":[1]},{"b":null}]', "go", { go: { omitempty: false } });
    expect(out).toContain("type Root []RootItem");
    expect(out).toMatch(/A\s+\[\]int64\s+`json:"a"`/);
    expect(out).toMatch(/B\s+any\s+`json:"b"`/);
  });

  it("de-duplicates colliding field names and escapes tags", () => {
    const out = gen('{"user_id":1,"userId":2,"a\\"b":3}', "go");
    expect(out).toContain("UserID ");
    expect(out).toContain("UserID2 ");
    expect(out).toContain('`json:"a\\"b"`');
  });

  it("uses pointers for nullable scalars inside arrays", () => {
    expect(gen('{"a":[1,null]}', "go")).toContain("[]*int64");
  });
});

describe("Zod output", () => {
  it("generates schemas with dependencies first", () => {
    const out = gen('{"id":1,"name":"Ann","address":{"city":"X","zip":null},"orders":[{"sku":"a","qty":1.5},{"sku":"b"}]}', "zod");
    expect(out).toBe(`import { z } from "zod";

const OrderSchema = z.object({
  sku: z.string(),
  qty: z.number().optional(),
});

const AddressSchema = z.object({
  city: z.string(),
  zip: z.null(),
});

const RootSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  address: AddressSchema,
  orders: z.array(OrderSchema),
});
`);
  });

  it("supports nullable, unions, exports and inferred types", () => {
    const out = gen('[{"a":"x","b":1},{"a":null,"b":"y"}]', "zod", { zod: { inferTypes: true, exportSchemas: true } });
    expect(out).toContain("export const RootItemSchema = z.object({");
    expect(out).toContain("a: z.string().nullable(),");
    expect(out).toContain("b: z.union([z.number().int(), z.string()]),");
    expect(out).toContain("export const RootSchema = z.array(RootItemSchema);");
    expect(out).toContain("export type RootItem = z.infer<typeof RootItemSchema>;");
    expect(out).toContain("export type Root = z.infer<typeof RootSchema>;");
  });

  it("uses z.unknown for empty arrays", () => {
    expect(gen('{"a":[]}', "zod")).toContain("a: z.array(z.unknown()),");
  });
});

describe("generateTypes errors", () => {
  it("reports invalid JSON", () => {
    const result = generateTypes("{oops", base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Invalid JSON/);
  });
});
