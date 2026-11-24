/**
 * JSON formatter logic. Uses its own strict (RFC 8259) parser instead of JSON.parse so that
 *  - number literals are kept verbatim (JSON.parse would turn 12345678901234567890 into 12345678901234567000)
 *  - string escapes (\u00e9, \/) are kept verbatim
 *  - duplicate keys are kept
 *  - errors carry an exact line/column
 */

export type JsonNode =
  | { type: "object"; entries: { key: string; rawKey: string; value: JsonNode }[] }
  | { type: "array"; items: JsonNode[] }
  | { type: "string"; raw: string }
  | { type: "number"; raw: string }
  | { type: "literal"; raw: "true" | "false" | "null" };

export interface JsonError {
  message: string;
  /** 0-based character offset in the input. */
  offset: number;
  /** 1-based. */
  line: number;
  column: number;
}

export type ParseResult = { ok: true; value: JsonNode } | { ok: false; error: JsonError };

export const MAX_DEPTH = 512;

class ParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

const describeChar = (ch: string) => (ch === undefined ? "end of input" : `"${ch}"`);

class Parser {
  pos = 0;
  constructor(readonly text: string) {}

  parseDocument(): JsonNode {
    this.skipWhitespace();
    if (this.pos >= this.text.length) throw new ParseError("Input is empty", 0);
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      throw new ParseError(`Unexpected ${describeChar(this.text[this.pos])} after the JSON value`, this.pos);
    }
    return value;
  }

  private skipWhitespace() {
    while (this.pos < this.text.length && WHITESPACE.has(this.text[this.pos])) this.pos++;
  }

  private parseValue(depth: number): JsonNode {
    if (depth > MAX_DEPTH) throw new ParseError(`Nesting is deeper than ${MAX_DEPTH} levels`, this.pos);
    const ch = this.text[this.pos];
    if (ch === "{") return this.parseObject(depth);
    if (ch === "[") return this.parseArray(depth);
    if (ch === '"') return { type: "string", raw: this.parseStringRaw() };
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.parseNumber();
    for (const word of ["true", "false", "null"] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return { type: "literal", raw: word };
      }
    }
    throw new ParseError(`Unexpected ${describeChar(ch)}, expected a JSON value`, this.pos);
  }

  private parseObject(depth: number): JsonNode {
    const entries: { key: string; rawKey: string; value: JsonNode }[] = [];
    this.pos++; // {
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return { type: "object", entries };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        throw new ParseError(`Unexpected ${describeChar(this.text[this.pos])}, expected a string key`, this.pos);
      }
      const rawKey = this.parseStringRaw();
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        throw new ParseError(`Unexpected ${describeChar(this.text[this.pos])}, expected ":" after the key`, this.pos);
      }
      this.pos++;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      entries.push({ key: JSON.parse(rawKey) as string, rawKey, value });
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos++;
        continue;
      }
      if (next === "}") {
        this.pos++;
        return { type: "object", entries };
      }
      throw new ParseError(`Unexpected ${describeChar(next)}, expected "," or "}"`, this.pos);
    }
  }

  private parseArray(depth: number): JsonNode {
    const items: JsonNode[] = [];
    this.pos++; // [
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return { type: "array", items };
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos++;
        continue;
      }
      if (next === "]") {
        this.pos++;
        return { type: "array", items };
      }
      throw new ParseError(`Unexpected ${describeChar(next)}, expected "," or "]"`, this.pos);
    }
  }

  /** Returns the string literal including its quotes, validated. */
  private parseStringRaw(): string {
    const start = this.pos;
    this.pos++; // opening quote
    for (;;) {
      if (this.pos >= this.text.length) throw new ParseError("Unterminated string", start);
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos++;
        return this.text.slice(start, this.pos);
      }
      if (ch < " ") {
        throw new ParseError("Control character in string (use an escape such as \\n)", this.pos);
      }
      if (ch === "\\") {
        const esc = this.text[this.pos + 1];
        if (esc === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.pos + 2, this.pos + 6))) {
            throw new ParseError("Invalid \\u escape, expected 4 hex digits", this.pos);
          }
          this.pos += 6;
        } else if (esc !== undefined && '"\\/bfnrt'.includes(esc)) {
          this.pos += 2;
        } else {
          throw new ParseError(`Invalid escape sequence "\\${esc ?? ""}"`, this.pos);
        }
      } else {
        this.pos++;
      }
    }
  }

  private parseNumber(): JsonNode {
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (!match) throw new ParseError("Invalid number", this.pos);
    this.pos += match[0].length;
    return { type: "number", raw: match[0] };
  }
}

function locate(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

export function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: new Parser(text).parseDocument() };
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    return { ok: false, error: { message: e.message, offset: e.offset, ...locate(text, e.offset) } };
  }
}

export function formatError(error: JsonError): string {
  return `${error.message} (line ${error.line}, column ${error.column})`;
}

export type Indent = 2 | 4 | "tab";

export interface FormatOptions {
  /** `null` = minified. */
  indent: Indent | null;
  sortKeys: boolean;
}

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function write(node: JsonNode, unit: string | null, sortKeys: boolean, level: number): string {
  switch (node.type) {
    case "string":
    case "number":
    case "literal":
      return node.raw;
    case "array": {
      if (node.items.length === 0) return "[]";
      const parts = node.items.map((item) => write(item, unit, sortKeys, level + 1));
      return wrap("[", "]", parts, unit, level);
    }
    case "object": {
      if (node.entries.length === 0) return "{}";
      const entries = sortKeys ? [...node.entries].sort((a, b) => compareKeys(a.key, b.key)) : node.entries;
      const sep = unit === null ? ":" : ": ";
      const parts = entries.map((e) => `${e.rawKey}${sep}${write(e.value, unit, sortKeys, level + 1)}`);
      return wrap("{", "}", parts, unit, level);
    }
  }
}

function wrap(open: string, close: string, parts: string[], unit: string | null, level: number): string {
  if (unit === null) return `${open}${parts.join(",")}${close}`;
  const inner = unit.repeat(level + 1);
  return `${open}\n${parts.map((p) => inner + p).join(",\n")}\n${unit.repeat(level)}${close}`;
}

/** Serialize a parsed document. */
export function stringifyJson(node: JsonNode, options: FormatOptions): string {
  const unit = options.indent === null ? null : options.indent === "tab" ? "\t" : " ".repeat(options.indent);
  return write(node, unit, options.sortKeys, 0);
}

export type FormatResult = { ok: true; output: string } | { ok: false; error: JsonError };

/** Parse and re-serialize in one go (prettify, minify, sort keys). */
export function formatJson(text: string, options: FormatOptions): FormatResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return { ok: true, output: stringifyJson(parsed.value, options) };
}
