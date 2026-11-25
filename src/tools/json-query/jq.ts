/**
 * A jq-style query evaluator (a practical subset of jq 1.7, no eval, no I/O). Supported:
 *   paths:      . .a .a.b ."a b" .["a"] .[0] .[-1] .[1:3] .[] .a[]? ..   (postfix ? suppresses errors)
 *   operators:  | , // + - * / %  == != < <= > >=  and or  (also unary -)
 *   literals:   numbers, "strings" with \(interpolation), true false null, [array, ...], {object, ...}
 *   control:    if .. then .. elif .. else .. end
 *   functions:  select map map_values length keys values empty not add any all flatten range floor ceil round sqrt abs
 *               tostring tonumber tojson fromjson type reverse sort sort_by group_by unique unique_by min max min_by max_by
 *               first last first(f) limit has contains inside join split test startswith endswith ltrimstr rtrimstr
 *               ascii_downcase ascii_upcase to_entries from_entries with_entries recurse(f)
 *               type selectors: numbers strings booleans nulls arrays objects scalars iterables
 * Not supported: variables (as $x), reduce/foreach, def, try/catch, path expressions (del, paths, |=), @formats, input.
 */

export class JqError extends Error {}

// ---------------------------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------------------------

type Token =
  | { t: "num"; value: number; pos: number }
  | { t: "str"; parts: (string | Token[])[]; pos: number }
  | { t: "field"; name: string; pos: number }
  | { t: "ident"; name: string; pos: number }
  | { t: "punct"; value: string; pos: number }
  | { t: "eof"; pos: number };

const PUNCT = ["..", "==", "!=", "<=", ">=", "//", "|", ",", ".", "[", "]", "(", ")", "{", "}", ":", ";", "?", "+", "-", "*", "/", "%", "<", ">"];

function lex(src: string, start = 0, closeParen = false): { tokens: Token[]; end: number } {
  const tokens: Token[] = [];
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (closeParen) {
      if (ch === "(") depth++;
      if (ch === ")") {
        if (depth === 0) return { tokens: [...tokens, { t: "eof", pos: i }], end: i };
        depth--;
      }
    }
    if (ch === '"') {
      const { token, end } = lexString(src, i);
      tokens.push(token);
      i = end;
      continue;
    }
    if (ch === "." && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: "field", name: src.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && !(ch === "." && !/\d/.test(src[i + 1] ?? ""))) {
      tokens.push({ t: "num", value: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (ident) {
      tokens.push({ t: "ident", name: ident[0], pos: i });
      i += ident[0].length;
      continue;
    }
    if (ch === "$") throw new JqError(`Variables ($name) are not supported (position ${i})`);
    if (ch === "@") throw new JqError(`@formats are not supported (position ${i})`);
    const punct = PUNCT.find((p) => src.startsWith(p, i));
    if (!punct) throw new JqError(`Unexpected character "${ch}" at position ${i}`);
    tokens.push({ t: "punct", value: punct, pos: i });
    i += punct.length;
  }
  if (closeParen) throw new JqError("Unterminated string interpolation");
  tokens.push({ t: "eof", pos: src.length });
  return { tokens, end: i };
}

function lexString(src: string, start: number): { token: Token; end: number } {
  const parts: (string | Token[])[] = [];
  let buf = "";
  let i = start + 1;
  for (;;) {
    if (i >= src.length) throw new JqError(`Unterminated string starting at position ${start}`);
    const ch = src[i++];
    if (ch === '"') {
      if (buf !== "" || parts.length === 0) parts.push(buf);
      return { token: { t: "str", parts, pos: start }, end: i };
    }
    if (ch !== "\\") {
      buf += ch;
      continue;
    }
    const esc = src[i++];
    switch (esc) {
      case "n": buf += "\n"; break;
      case "t": buf += "\t"; break;
      case "r": buf += "\r"; break;
      case "b": buf += "\b"; break;
      case "f": buf += "\f"; break;
      case "/": buf += "/"; break;
      case "\\": buf += "\\"; break;
      case '"': buf += '"'; break;
      case "u": {
        const hex = src.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new JqError(`Invalid \\u escape at position ${i - 2}`);
        buf += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      case "(": {
        if (buf !== "") parts.push(buf);
        buf = "";
        const inner = lex(src, i, true);
        parts.push(inner.tokens);
        i = inner.end + 1;
        break;
      }
      default:
        throw new JqError(`Invalid escape "\\${esc ?? ""}" at position ${i - 2}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// AST + parser
// ---------------------------------------------------------------------------------------------

type Node =
  | { t: "identity" }
  | { t: "recurse" }
  | { t: "lit"; value: unknown }
  | { t: "str"; parts: (string | Node)[] }
  | { t: "field"; target: Node; name: Node }
  | { t: "index"; target: Node; index: Node }
  | { t: "slice"; target: Node; from: Node | null; to: Node | null }
  | { t: "iterate"; target: Node }
  | { t: "try"; body: Node }
  | { t: "pipe" | "comma" | "alt" | "and" | "or"; left: Node; right: Node }
  | { t: "arith"; op: "+" | "-" | "*" | "/" | "%"; left: Node; right: Node }
  | { t: "cmp"; op: "==" | "!=" | "<" | "<=" | ">" | ">="; left: Node; right: Node }
  | { t: "neg"; operand: Node }
  | { t: "array"; body: Node | null }
  | { t: "object"; entries: { key: Node; value: Node }[] }
  | { t: "if"; cond: Node; then: Node; otherwise: Node | null }
  | { t: "call"; name: string; args: Node[]; pos: number };

class Parser {
  pos = 0;
  constructor(readonly tokens: Token[]) {}

  get cur(): Token {
    return this.tokens[this.pos];
  }

  where(tok: Token = this.cur) {
    return tok.t === "eof" ? "end of query" : `position ${tok.pos}`;
  }

  atEnd() {
    return this.cur.t === "eof";
  }

  isPunct(value: string) {
    const c = this.cur;
    return c.t === "punct" && c.value === value;
  }

  isIdent(name: string) {
    const c = this.cur;
    return c.t === "ident" && c.name === name;
  }

  eatPunct(value: string): boolean {
    if (this.isPunct(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectPunct(value: string) {
    if (!this.eatPunct(value)) throw new JqError(`Expected "${value}" at ${this.where()}`);
  }

  expectIdent(name: string) {
    if (!this.isIdent(name)) throw new JqError(`Expected "${name}" at ${this.where()}`);
    this.pos++;
  }

  parseProgram(): Node {
    if (this.atEnd()) return { t: "identity" };
    const node = this.parsePipe();
    if (!this.atEnd()) throw new JqError(`Unexpected ${this.describe()} at ${this.where()}`);
    return node;
  }

  describe() {
    const c = this.cur;
    return c.t === "punct" ? `"${c.value}"` : c.t === "ident" ? `"${c.name}"` : c.t === "eof" ? "end" : c.t;
  }

  parsePipe(): Node {
    const left = this.parseComma();
    if (this.eatPunct("|")) return { t: "pipe", left, right: this.parsePipe() };
    return left;
  }

  parseComma(): Node {
    let left = this.parseAlt();
    while (this.eatPunct(",")) left = { t: "comma", left, right: this.parseAlt() };
    return left;
  }

  parseAlt(): Node {
    const left = this.parseOr();
    if (this.eatPunct("//")) return { t: "alt", left, right: this.parseAlt() };
    return left;
  }

  parseOr(): Node {
    let left = this.parseAnd();
    while (this.isIdent("or")) {
      this.pos++;
      left = { t: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  parseAnd(): Node {
    let left = this.parseCompare();
    while (this.isIdent("and")) {
      this.pos++;
      left = { t: "and", left, right: this.parseCompare() };
    }
    return left;
  }

  parseCompare(): Node {
    const left = this.parseAdditive();
    for (const op of ["==", "!=", "<=", ">=", "<", ">"] as const) {
      if (this.eatPunct(op)) return { t: "cmp", op, left, right: this.parseAdditive() };
    }
    return left;
  }

  parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eatPunct("+")) left = { t: "arith", op: "+", left, right: this.parseMultiplicative() };
      else if (this.eatPunct("-")) left = { t: "arith", op: "-", left, right: this.parseMultiplicative() };
      else return left;
    }
  }

  parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.eatPunct("*")) left = { t: "arith", op: "*", left, right: this.parseUnary() };
      else if (this.eatPunct("/")) left = { t: "arith", op: "/", left, right: this.parseUnary() };
      else if (this.eatPunct("%")) left = { t: "arith", op: "%", left, right: this.parseUnary() };
      else return left;
    }
  }

  parseUnary(): Node {
    if (this.eatPunct("-")) return { t: "neg", operand: this.parseUnary() };
    return this.parsePostfix();
  }

  parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      const c = this.cur;
      if (c.t === "field") {
        this.pos++;
        node = { t: "field", target: node, name: { t: "lit", value: c.name } };
      } else if (c.t === "punct" && c.value === "." && this.tokens[this.pos + 1]?.t === "str") {
        this.pos++;
        node = { t: "field", target: node, name: this.parseStringNode() };
      } else if (c.t === "punct" && c.value === "[") {
        node = this.parseBracket(node);
      } else if (c.t === "punct" && c.value === "." && this.tokens[this.pos + 1]?.t === "punct" && (this.tokens[this.pos + 1] as { value: string }).value === "[") {
        this.pos++;
        node = this.parseBracket(node);
      } else if (c.t === "punct" && c.value === "?") {
        this.pos++;
        node = { t: "try", body: node };
      } else return node;
    }
  }

  parseBracket(target: Node): Node {
    this.expectPunct("[");
    if (this.eatPunct("]")) return { t: "iterate", target };
    if (this.eatPunct(":")) {
      const to = this.parsePipe();
      this.expectPunct("]");
      return { t: "slice", target, from: null, to };
    }
    const first = this.parsePipe();
    if (this.eatPunct(":")) {
      const to = this.isPunct("]") ? null : this.parsePipe();
      this.expectPunct("]");
      return { t: "slice", target, from: first, to };
    }
    this.expectPunct("]");
    return { t: "index", target, index: first };
  }

  parseStringNode(): Node {
    const c = this.cur;
    if (c.t !== "str") throw new JqError(`Expected a string at ${this.where()}`);
    this.pos++;
    const parts = c.parts.map((p) => (typeof p === "string" ? p : new Parser(p).parseProgram()));
    if (parts.length === 1 && typeof parts[0] === "string") return { t: "lit", value: parts[0] };
    return { t: "str", parts };
  }

  parsePrimary(): Node {
    const c = this.cur;
    switch (c.t) {
      case "num":
        this.pos++;
        return { t: "lit", value: c.value };
      case "str":
        return this.parseStringNode();
      case "field":
        this.pos++;
        return { t: "field", target: { t: "identity" }, name: { t: "lit", value: c.name } };
      case "punct":
        return this.parsePunctPrimary(c);
      case "ident":
        return this.parseIdent(c);
      case "eof":
        throw new JqError("Unexpected end of query");
    }
  }

  parsePunctPrimary(c: Extract<Token, { t: "punct" }>): Node {
    switch (c.value) {
      case "..":
        this.pos++;
        return { t: "recurse" };
      case ".": {
        this.pos++;
        if (this.cur.t === "str") return { t: "field", target: { t: "identity" }, name: this.parseStringNode() };
        if (this.isPunct("[")) return this.parseBracket({ t: "identity" });
        return { t: "identity" };
      }
      case "(": {
        this.pos++;
        const inner = this.parsePipe();
        this.expectPunct(")");
        return inner;
      }
      case "[": {
        this.pos++;
        if (this.eatPunct("]")) return { t: "array", body: null };
        const body = this.parsePipe();
        this.expectPunct("]");
        return { t: "array", body };
      }
      case "{":
        return this.parseObject();
      default:
        throw new JqError(`Unexpected "${c.value}" at position ${c.pos}`);
    }
  }

  parseObject(): Node {
    this.expectPunct("{");
    const entries: { key: Node; value: Node }[] = [];
    if (this.eatPunct("}")) return { t: "object", entries };
    for (;;) {
      const c = this.cur;
      let key: Node;
      let value: Node | null = null;
      if (c.t === "ident") {
        this.pos++;
        key = { t: "lit", value: c.name };
        value = { t: "field", target: { t: "identity" }, name: key };
      } else if (c.t === "str") {
        key = this.parseStringNode();
        if (key.t === "lit") value = { t: "field", target: { t: "identity" }, name: key };
      } else if (c.t === "num") {
        throw new JqError(`Object keys must be strings (position ${c.pos})`);
      } else if (this.eatPunct("(")) {
        key = this.parsePipe();
        this.expectPunct(")");
      } else {
        throw new JqError(`Expected an object key at ${this.where()}`);
      }
      if (this.eatPunct(":")) value = this.parseObjectValue();
      else if (value === null) throw new JqError(`Expected ":" after the key at ${this.where()}`);
      entries.push({ key, value });
      if (this.eatPunct(",")) continue;
      this.expectPunct("}");
      return { t: "object", entries };
    }
  }

  /** Object values bind tighter than "," and "|" (like jq): `{a: 1 + 2, b: .x}`. */
  parseObjectValue(): Node {
    let left = this.parseAlt();
    while (this.eatPunct("|")) left = { t: "pipe", left, right: this.parseAlt() };
    return left;
  }

  parseIdent(c: Extract<Token, { t: "ident" }>): Node {
    this.pos++;
    switch (c.name) {
      case "true":
        return { t: "lit", value: true };
      case "false":
        return { t: "lit", value: false };
      case "null":
        return { t: "lit", value: null };
      case "if":
        return this.parseIf();
      case "reduce":
      case "foreach":
      case "def":
      case "try":
      case "label":
      case "import":
      case "include":
        throw new JqError(`"${c.name}" is not supported in this tool (position ${c.pos})`);
      case "then":
      case "elif":
      case "else":
      case "end":
      case "and":
      case "or":
      case "as":
        throw new JqError(`Unexpected "${c.name}" at position ${c.pos}`);
    }
    const args: Node[] = [];
    if (this.eatPunct("(")) {
      for (;;) {
        args.push(this.parsePipe());
        if (this.eatPunct(";")) continue;
        this.expectPunct(")");
        break;
      }
    }
    return { t: "call", name: c.name, args, pos: c.pos };
  }

  parseIf(): Node {
    const cond = this.parsePipe();
    this.expectIdent("then");
    const then = this.parsePipe();
    let otherwise: Node | null = null;
    if (this.isIdent("elif")) {
      this.pos++;
      otherwise = this.parseIf();
      return { t: "if", cond, then, otherwise };
    }
    if (this.isIdent("else")) {
      this.pos++;
      otherwise = this.parsePipe();
    }
    this.expectIdent("end");
    return { t: "if", cond, then, otherwise };
  }
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

export function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "object" ? "object" : typeof v;
}

const truthy = (v: unknown) => v !== null && v !== false;

const typeRank = (v: unknown) => ["null", "boolean", "number", "string", "array", "object"].indexOf(typeOf(v)) + (v === true ? 0.5 : 0);

/** jq ordering: null < false < true < numbers < strings < arrays < objects. */
export function compareValues(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareValues(a[i], b[i]);
      if (c !== 0) return c;
    }
    return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0;
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const kc = compareValues(ka, kb);
    if (kc !== 0) return kc;
    for (const k of ka) {
      const c = compareValues(a[k], b[k]);
      if (c !== 0) return c;
    }
  }
  return 0;
}

const show = (v: unknown) => {
  const text = JSON.stringify(v) ?? "null";
  return text.length > 30 ? `${text.slice(0, 27)}...` : text;
};

function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k] as Obj, v) : v;
  return out;
}

function arith(op: "+" | "-" | "*" | "/" | "%", a: unknown, b: unknown): unknown {
  const err = (verb: string) => new JqError(`${typeOf(a)} (${show(a)}) and ${typeOf(b)} (${show(b)}) cannot be ${verb}`);
  switch (op) {
    case "+":
      if (a === null) return b;
      if (b === null) return a;
      if (typeof a === "number" && typeof b === "number") return a + b;
      if (typeof a === "string" && typeof b === "string") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (isObj(a) && isObj(b)) return { ...a, ...b };
      throw err("added");
    case "-":
      if (typeof a === "number" && typeof b === "number") return a - b;
      if (Array.isArray(a) && Array.isArray(b)) return a.filter((x) => !b.some((y) => compareValues(x, y) === 0));
      throw err("subtracted");
    case "*":
      if (typeof a === "number" && typeof b === "number") return a * b;
      if (typeof a === "string" && typeof b === "number") return b > 0 ? a.repeat(Math.ceil(b)) : null;
      if (typeof a === "number" && typeof b === "string") return a > 0 ? b.repeat(Math.ceil(a)) : null;
      if (isObj(a) && isObj(b)) return deepMerge(a, b);
      throw err("multiplied");
    case "/":
      if (typeof a === "number" && typeof b === "number") {
        if (b === 0) throw err("divided because the divisor is zero");
        return a / b;
      }
      if (typeof a === "string" && typeof b === "string") return a === "" ? [] : a.split(b);
      throw err("divided");
    case "%":
      if (typeof a === "number" && typeof b === "number") {
        const bi = Math.trunc(b);
        if (bi === 0) throw err("divided because the divisor is zero");
        return Math.trunc(a) % bi;
      }
      throw err("divided");
  }
}

// ---------------------------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------------------------

type Gen = Generator<unknown, void, undefined>;

class Budget {
  steps = 0;
  tick() {
    if (++this.steps > 3_000_000) throw new JqError("The query ran too long (step limit reached)");
  }
}

function* ev(node: Node, input: unknown, b: Budget): Gen {
  b.tick();
  switch (node.t) {
    case "identity":
      yield input;
      return;
    case "lit":
      yield node.value;
      return;
    case "recurse":
      yield* recurse(input, b);
      return;
    case "str":
      yield* evString(node.parts, 0, "", input, b);
      return;
    case "field":
      for (const name of ev(node.name, input, b)) {
        for (const target of ev(node.target, input, b)) yield indexValue(target, name);
      }
      return;
    case "index":
      for (const index of ev(node.index, input, b)) {
        for (const target of ev(node.target, input, b)) yield indexValue(target, index);
      }
      return;
    case "slice":
      for (const target of ev(node.target, input, b)) {
        const froms = node.from ? [...ev(node.from, input, b)] : [null];
        const tos = node.to ? [...ev(node.to, input, b)] : [null];
        for (const to of tos) for (const from of froms) yield sliceValue(target, from, to);
      }
      return;
    case "iterate":
      for (const target of ev(node.target, input, b)) {
        if (Array.isArray(target)) yield* target;
        else if (isObj(target)) yield* Object.values(target);
        else throw new JqError(`Cannot iterate over ${typeOf(target)}${target === null ? "" : ` (${show(target)})`}`);
      }
      return;
    case "try":
      try {
        for (const v of ev(node.body, input, b)) yield v;
      } catch (err) {
        if (!(err instanceof JqError) || err.message.startsWith("The query ran too long")) throw err;
      }
      return;
    case "pipe":
      for (const mid of ev(node.left, input, b)) yield* ev(node.right, mid, b);
      return;
    case "comma":
      yield* ev(node.left, input, b);
      yield* ev(node.right, input, b);
      return;
    case "alt": {
      let any = false;
      try {
        for (const v of ev(node.left, input, b)) {
          if (truthy(v)) {
            any = true;
            yield v;
          }
        }
      } catch (err) {
        if (!(err instanceof JqError)) throw err;
      }
      if (!any) yield* ev(node.right, input, b);
      return;
    }
    case "and":
      for (const l of ev(node.left, input, b)) {
        if (!truthy(l)) yield false;
        else for (const r of ev(node.right, input, b)) yield truthy(r);
      }
      return;
    case "or":
      for (const l of ev(node.left, input, b)) {
        if (truthy(l)) yield true;
        else for (const r of ev(node.right, input, b)) yield truthy(r);
      }
      return;
    case "arith":
      for (const r of ev(node.right, input, b)) for (const l of ev(node.left, input, b)) yield arith(node.op, l, r);
      return;
    case "cmp":
      for (const r of ev(node.right, input, b)) {
        for (const l of ev(node.left, input, b)) {
          const c = compareValues(l, r);
          yield node.op === "==" ? c === 0 : node.op === "!=" ? c !== 0 : node.op === "<" ? c < 0 : node.op === "<=" ? c <= 0 : node.op === ">" ? c > 0 : c >= 0;
        }
      }
      return;
    case "neg":
      for (const v of ev(node.operand, input, b)) {
        if (typeof v !== "number") throw new JqError(`${typeOf(v)} (${show(v)}) cannot be negated`);
        yield -v;
      }
      return;
    case "array":
      yield node.body ? [...ev(node.body, input, b)] : [];
      return;
    case "object":
      yield* evObject(node.entries, 0, {}, input, b);
      return;
    case "if":
      for (const c of ev(node.cond, input, b)) {
        if (truthy(c)) yield* ev(node.then, input, b);
        else if (node.otherwise) yield* ev(node.otherwise, input, b);
        else yield input;
      }
      return;
    case "call":
      yield* callFunction(node, input, b);
      return;
  }
}

/** Pre-order walk (`..`). Iterative on purpose: nested `yield*` would cost O(depth) per value on deep data. */
function* recurse(root: unknown, b: Budget): Gen {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    b.tick();
    yield v;
    const children = Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

function* evString(parts: (string | Node)[], i: number, acc: string, input: unknown, b: Budget): Gen {
  if (i === parts.length) {
    yield acc;
    return;
  }
  const part = parts[i];
  if (typeof part === "string") {
    yield* evString(parts, i + 1, acc + part, input, b);
    return;
  }
  for (const v of ev(part, input, b)) {
    yield* evString(parts, i + 1, acc + (typeof v === "string" ? v : JSON.stringify(v)), input, b);
  }
}

function* evObject(entries: { key: Node; value: Node }[], i: number, acc: Obj, input: unknown, b: Budget): Gen {
  if (i === entries.length) {
    yield acc;
    return;
  }
  const { key, value } = entries[i];
  for (const k of ev(key, input, b)) {
    if (typeof k !== "string") throw new JqError(`Object keys must be strings, got ${typeOf(k)} (${show(k)})`);
    for (const v of ev(value, input, b)) yield* evObject(entries, i + 1, { ...acc, [k]: v }, input, b);
  }
}

function indexValue(target: unknown, index: unknown): unknown {
  if (typeof index === "string") {
    if (isObj(target)) return Object.prototype.hasOwnProperty.call(target, index) ? target[index] : null;
    if (target === null) return null;
    throw new JqError(`Cannot index ${typeOf(target)} with "${index}"`);
  }
  if (typeof index === "number") {
    if (Array.isArray(target)) {
      const i = Math.floor(index);
      const at = i < 0 ? target.length + i : i;
      return at >= 0 && at < target.length ? target[at] : null;
    }
    if (target === null) return null;
    throw new JqError(`Cannot index ${typeOf(target)} with number`);
  }
  if (index === null && target === null) return null;
  throw new JqError(`Cannot index ${typeOf(target)} with ${typeOf(index)}`);
}

function sliceValue(target: unknown, from: unknown, to: unknown): unknown {
  if (target === null) return null;
  if (!Array.isArray(target) && typeof target !== "string") throw new JqError(`Cannot slice ${typeOf(target)}`);
  if ((from !== null && typeof from !== "number") || (to !== null && typeof to !== "number")) {
    throw new JqError("Slice indices must be numbers");
  }
  const len = target.length;
  const clamp = (n: number) => Math.min(Math.max(n < 0 ? len + n : n, 0), len);
  const start = from === null ? 0 : clamp(Math.floor(from as number));
  const end = to === null ? len : clamp(Math.ceil(to as number));
  return target.slice(start, Math.max(start, end));
}

function toArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new JqError(`${typeOf(v)} (${show(v)}) cannot be used with ${what}; an array is required`);
  return v;
}

function flatten(arr: unknown[], depth: number): unknown[] {
  return arr.flatMap((x) => (Array.isArray(x) && depth > 0 ? flatten(x, depth - 1) : [x]));
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : (JSON.stringify(v) ?? "null");
}

function numArg(v: unknown, fn: string): number {
  if (typeof v !== "number") throw new JqError(`${fn}: ${typeOf(v)} (${show(v)}) is not a number`);
  return v;
}

function strInput(v: unknown, fn: string): string {
  if (typeof v !== "string") throw new JqError(`${fn}: ${typeOf(v)} (${show(v)}) is not a string`);
  return v;
}

function contains(a: unknown, b: unknown): boolean {
  if (isObj(a) && isObj(b)) return Object.entries(b).every(([k, v]) => k in a && contains(a[k], v));
  if (Array.isArray(a) && Array.isArray(b)) return b.every((bv) => a.some((av) => contains(av, bv)));
  if (typeof a === "string" && typeof b === "string") return a.includes(b);
  if (typeOf(a) === typeOf(b)) return compareValues(a, b) === 0;
  throw new JqError(`${typeOf(a)} (${show(a)}) and ${typeOf(b)} (${show(b)}) cannot have their containment checked`);
}

function makeRegex(pattern: unknown, flags: unknown): RegExp {
  if (typeof pattern !== "string") throw new JqError(`${typeOf(pattern)} (${show(pattern)}) cannot be matched, as it is not a string`);
  const allowed = typeof flags === "string" ? flags.replace(/[^gimsx]/g, "").replace("x", "") : "";
  try {
    return new RegExp(pattern, allowed.replace("g", ""));
  } catch {
    throw new JqError(`${pattern} (at offset 0) is not a valid regex`);
  }
}

const sortKey = (a: unknown, b: unknown) => compareValues(a, b);

function joinPart(x: unknown): string {
  if (x === null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  throw new JqError(`Cannot join with ${typeOf(x)}`);
}

/** Evaluate `f` for each element and pair the results, as used by sort_by / group_by / ... */
function keyed(arr: unknown[], f: Node, b: Budget): { item: unknown; key: unknown[] }[] {
  return arr.map((item) => ({ item, key: [...ev(f, item, b)] }));
}

function* callFunction(node: Extract<Node, { t: "call" }>, input: unknown, b: Budget): Gen {
  const { name, args } = node;
  const arity = args.length;
  const fail = (): never => {
    throw new JqError(`${name}/${arity} is not defined (position ${node.pos})`);
  };
  const arg = (i: number) => [...ev(args[i], input, b)];

  if (arity === 0) {
    switch (name) {
      case "empty":
        return;
      case "not":
        yield !truthy(input);
        return;
      case "length":
        if (input === null) yield 0;
        else if (typeof input === "string") yield [...input].length;
        else if (Array.isArray(input)) yield input.length;
        else if (isObj(input)) yield Object.keys(input).length;
        else if (typeof input === "number") yield Math.abs(input);
        else throw new JqError(`${typeOf(input)} (${show(input)}) has no length`);
        return;
      case "keys":
      case "keys_unsorted":
        if (isObj(input)) yield name === "keys" ? Object.keys(input).sort() : Object.keys(input);
        else if (Array.isArray(input)) yield input.map((_, i) => i);
        else throw new JqError(`${typeOf(input)} (${show(input)}) has no keys`);
        return;
      case "values":
        if (input !== null) yield input;
        return;
      case "add": {
        const items = input === null ? [] : isObj(input) ? Object.values(input) : toArray(input, "add");
        let acc: unknown = null;
        for (const x of items) acc = arith("+", acc, x);
        yield acc;
        return;
      }
      case "any":
        yield toArray(input, "any").some(truthy);
        return;
      case "all":
        yield toArray(input, "all").every(truthy);
        return;
      case "flatten":
        yield flatten(toArray(input, "flatten"), 1e9);
        return;
      case "floor":
        yield Math.floor(numArg(input, name));
        return;
      case "ceil":
        yield Math.ceil(numArg(input, name));
        return;
      case "round":
        yield Math.round(numArg(input, name));
        return;
      case "sqrt":
        yield Math.sqrt(numArg(input, name));
        return;
      case "abs":
        yield Math.abs(numArg(input, name));
        return;
      case "tostring":
        yield toStr(input);
        return;
      case "tojson":
        yield JSON.stringify(input) ?? "null";
        return;
      case "fromjson":
        try {
          yield JSON.parse(strInput(input, name));
        } catch (err) {
          if (err instanceof JqError) throw err;
          throw new JqError(`${show(input)} is not valid JSON`);
        }
        return;
      case "tonumber": {
        if (typeof input === "number") yield input;
        else if (typeof input === "string" && input.trim() !== "" && Number.isFinite(Number(input))) yield Number(input);
        else throw new JqError(`${typeOf(input)} (${show(input)}) cannot be parsed as a number`);
        return;
      }
      case "type":
        yield typeOf(input);
        return;
      case "reverse":
        yield typeof input === "string" ? [...input].reverse().join("") : input === null ? [] : [...toArray(input, "reverse")].reverse();
        return;
      case "sort":
        yield [...toArray(input, "sort")].sort(sortKey);
        return;
      case "unique":
        yield [...toArray(input, "unique")].sort(sortKey).filter((x, i, a) => i === 0 || compareValues(a[i - 1], x) !== 0);
        return;
      case "min":
        yield toArray(input, "min").reduce<unknown>((m, x, i) => (i === 0 || compareValues(x, m) < 0 ? x : m), null);
        return;
      case "max":
        yield toArray(input, "max").reduce<unknown>((m, x, i) => (i === 0 || compareValues(x, m) >= 0 ? x : m), null);
        return;
      case "first":
        yield indexValue(input, 0);
        return;
      case "last":
        yield indexValue(input, -1);
        return;
      case "ascii_downcase":
        yield strInput(input, name).replace(/[A-Z]/g, (c) => c.toLowerCase());
        return;
      case "ascii_upcase":
        yield strInput(input, name).replace(/[a-z]/g, (c) => c.toUpperCase());
        return;
      case "to_entries":
        if (!isObj(input)) throw new JqError(`${typeOf(input)} (${show(input)}) has no keys`);
        yield Object.entries(input).map(([key, value]) => ({ key, value }));
        return;
      case "from_entries": {
        const out: Obj = {};
        for (const e of toArray(input, "from_entries")) {
          if (!isObj(e)) throw new JqError(`Cannot use ${typeOf(e)} (${show(e)}) as an object entry`);
          const k = e.key ?? e.k ?? e.name ?? e.Name ?? e.Key ?? e.K;
          const v = e.value ?? e.v ?? e.Value ?? e.V ?? null;
          if (k === null || k === undefined) throw new JqError("from_entries: entry has no key");
          out[typeof k === "string" ? k : toStr(k)] = v;
        }
        yield out;
        return;
      }
      case "recurse":
        yield* recurse(input, b);
        return;
      case "numbers":
        if (typeof input === "number") yield input;
        return;
      case "strings":
        if (typeof input === "string") yield input;
        return;
      case "booleans":
        if (typeof input === "boolean") yield input;
        return;
      case "nulls":
        if (input === null) yield input;
        return;
      case "arrays":
        if (Array.isArray(input)) yield input;
        return;
      case "objects":
        if (isObj(input)) yield input;
        return;
      case "scalars":
        if (input === null || typeof input !== "object") yield input;
        return;
      case "iterables":
        if (input !== null && typeof input === "object") yield input;
        return;
      default:
        return fail();
    }
  }

  switch (`${name}/${arity}`) {
    case "select/1":
      for (const c of ev(args[0], input, b)) if (truthy(c)) yield input;
      return;
    case "map/1":
      yield toArray(input, "map").flatMap((x) => [...ev(args[0], x, b)]);
      return;
    case "map_values/1": {
      if (Array.isArray(input)) {
        yield input.flatMap((x) => {
          const first = ev(args[0], x, b).next();
          return first.done ? [] : [first.value];
        });
      } else if (isObj(input)) {
        const out: Obj = {};
        for (const [k, v] of Object.entries(input)) {
          const first = ev(args[0], v, b).next();
          if (!first.done) out[k] = first.value;
        }
        yield out;
      } else throw new JqError(`Cannot iterate over ${typeOf(input)}`);
      return;
    }
    case "any/1":
      yield toArray(input, "any").some((x) => [...ev(args[0], x, b)].some(truthy));
      return;
    case "all/1":
      yield toArray(input, "all").every((x) => [...ev(args[0], x, b)].every(truthy));
      return;
    case "flatten/1":
      for (const d of arg(0)) yield flatten(toArray(input, "flatten"), numArg(d, "flatten"));
      return;
    case "range/1":
      for (const n of arg(0)) for (let i = 0; i < numArg(n, "range"); i++) { b.tick(); yield i; }
      return;
    case "range/2":
      for (const from of arg(0)) for (const to of arg(1)) for (let i = numArg(from, "range"); i < numArg(to, "range"); i++) { b.tick(); yield i; }
      return;
    case "sort_by/1":
      yield keyed(toArray(input, "sort_by"), args[0], b).sort((x, y) => compareValues(x.key, y.key)).map((e) => e.item);
      return;
    case "group_by/1":
    case "unique_by/1": {
      const sorted = keyed(toArray(input, name), args[0], b).sort((x, y) => compareValues(x.key, y.key));
      const groups: { key: unknown[]; items: unknown[] }[] = [];
      for (const e of sorted) {
        const last = groups[groups.length - 1];
        if (last && compareValues(last.key, e.key) === 0) last.items.push(e.item);
        else groups.push({ key: e.key, items: [e.item] });
      }
      yield name === "group_by" ? groups.map((g) => g.items) : groups.map((g) => g.items[0]);
      return;
    }
    case "min_by/1":
    case "max_by/1": {
      const items = keyed(toArray(input, name), args[0], b);
      let best: { item: unknown; key: unknown[] } | null = null;
      for (const e of items) {
        if (best === null) best = e;
        else {
          const c = compareValues(e.key, best.key);
          if (name === "min_by" ? c < 0 : c >= 0) best = e;
        }
      }
      yield best ? best.item : null;
      return;
    }
    case "first/1":
      for (const v of ev(args[0], input, b)) {
        yield v;
        return;
      }
      return;
    case "limit/2":
      for (const n of arg(0)) {
        let count = 0;
        if (numArg(n, "limit") <= 0) continue;
        for (const v of ev(args[1], input, b)) {
          yield v;
          if (++count >= numArg(n, "limit")) break;
        }
      }
      return;
    case "has/1":
      for (const key of arg(0)) {
        if (isObj(input) && typeof key === "string") yield Object.prototype.hasOwnProperty.call(input, key);
        else if (Array.isArray(input) && typeof key === "number") yield key >= 0 && key < input.length;
        else throw new JqError(`Cannot check whether ${typeOf(input)} has a ${typeOf(key)} key`);
      }
      return;
    case "contains/1":
      for (const x of arg(0)) yield contains(input, x);
      return;
    case "inside/1":
      for (const x of arg(0)) yield contains(x, input);
      return;
    case "join/1":
      for (const sep of arg(0)) {
        yield toArray(input, "join").map(joinPart).join(strInput(sep, "join"));
      }
      return;
    case "split/1":
      for (const sep of arg(0)) yield strInput(input, "split").split(strInput(sep, "split"));
      return;
    case "test/1":
    case "test/2": {
      const flags = arity === 2 ? arg(1) : [null];
      for (const pattern of arg(0)) for (const f of flags) yield makeRegex(pattern, f).test(strInput(input, "test"));
      return;
    }
    case "startswith/1":
      for (const s of arg(0)) yield strInput(input, name).startsWith(strInput(s, name));
      return;
    case "endswith/1":
      for (const s of arg(0)) yield strInput(input, name).endsWith(strInput(s, name));
      return;
    case "ltrimstr/1":
      for (const s of arg(0)) yield typeof input === "string" && typeof s === "string" && input.startsWith(s) ? input.slice(s.length) : input;
      return;
    case "rtrimstr/1":
      for (const s of arg(0)) yield typeof input === "string" && typeof s === "string" && s !== "" && input.endsWith(s) ? input.slice(0, -s.length) : input;
      return;
    case "with_entries/1": {
      if (!isObj(input)) throw new JqError(`${typeOf(input)} (${show(input)}) has no keys`);
      const out: Obj = {};
      for (const [key, value] of Object.entries(input)) {
        for (const e of ev(args[0], { key, value }, b)) {
          if (!isObj(e)) throw new JqError(`Cannot use ${typeOf(e)} as an object entry`);
          const k = e.key ?? e.k ?? e.name;
          out[typeof k === "string" ? k : toStr(k)] = e.value ?? e.v ?? null;
        }
      }
      yield out;
      return;
    }
    case "recurse/1": {
      const walk = function* (v: unknown): Gen {
        b.tick();
        yield v;
        for (const next of ev(args[0], v, b)) yield* walk(next);
      };
      yield* walk(input);
      return;
    }
    default:
      return fail();
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export const MAX_RESULTS = 10_000;

/** Run a jq-style program against `data`; returns every output value. Throws JqError. */
export function runJq(data: unknown, program: string): unknown[] {
  const { tokens } = lex(program);
  const ast = new Parser(tokens).parseProgram();
  const budget = new Budget();
  const results: unknown[] = [];
  for (const value of ev(ast, data, budget)) {
    results.push(value);
    if (results.length > MAX_RESULTS) throw new JqError(`More than ${MAX_RESULTS} results; narrow the query down`);
  }
  return results;
}
