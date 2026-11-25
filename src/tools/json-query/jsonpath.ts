/**
 * JSONPath (RFC 9535) evaluator, written without eval:
 *   $ . .. [] names, indexes (negative too), slices [a:b:c], wildcards, unions, filters [?(@.x > 1 && ...)],
 *   filter functions length(), count(), match(), search(), value().
 * Returns matched values together with their normalized paths ($['a'][0]).
 */

export interface PathNode {
  value: unknown;
  path: string;
}

export class JsonPathError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(position === undefined ? message : `${message} (at position ${position})`);
  }
}

// ---------------------------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------------------------

type Selector =
  | { t: "name"; name: string }
  | { t: "index"; index: number }
  | { t: "wildcard" }
  | { t: "slice"; start: number | null; end: number | null; step: number | null }
  | { t: "filter"; expr: Expr };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

interface Query {
  root: "$" | "@";
  segments: Segment[];
}

type Literal = string | number | boolean | null;

type Expr =
  | { t: "or" | "and"; left: Expr; right: Expr }
  | { t: "not"; operand: Expr }
  | { t: "cmp"; op: "==" | "!=" | "<" | "<=" | ">" | ">="; left: Operand; right: Operand }
  | { t: "exists"; query: Query }
  | { t: "fn"; call: FnCall };

type Operand = { t: "lit"; value: Literal } | { t: "query"; query: Query } | { t: "fn"; call: FnCall };

interface FnCall {
  name: string;
  args: (Operand | Expr)[];
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

const MAX_INT = 2 ** 53 - 1;
const NAME_START = /[A-Za-z_\u0080-\u{10FFFF}]/u;
const NAME_CHAR = /[A-Za-z0-9_\u0080-\u{10FFFF}]/u;

class Parser {
  pos = 0;
  constructor(readonly src: string) {}

  fail(message: string, pos = this.pos): never {
    throw new JsonPathError(message, pos);
  }

  peek(offset = 0) {
    return this.src[this.pos + offset];
  }

  ws() {
    while (this.pos < this.src.length && /[ \t\n\r]/.test(this.src[this.pos])) this.pos++;
  }

  eat(text: string): boolean {
    if (this.src.startsWith(text, this.pos)) {
      this.pos += text.length;
      return true;
    }
    return false;
  }

  expect(text: string) {
    if (!this.eat(text)) this.fail(`Expected "${text}"`);
  }

  parseTopLevel(): Query {
    this.ws();
    if (this.peek() !== "$") this.fail('A JSONPath query must start with "$"');
    const query = this.parseQuery();
    this.ws();
    if (this.pos < this.src.length) this.fail(`Unexpected "${this.peek()}"`);
    return query;
  }

  parseQuery(): Query {
    const root = this.src[this.pos] as "$" | "@";
    this.pos++;
    const segments: Segment[] = [];
    for (;;) {
      const save = this.pos;
      this.ws();
      const segment = this.parseSegment();
      if (!segment) {
        this.pos = save;
        break;
      }
      segments.push(segment);
    }
    return { root, segments };
  }

  parseSegment(): Segment | null {
    if (this.eat("..")) {
      if (this.peek() === "[") return { descendant: true, selectors: this.parseBracketed() };
      if (this.eat("*")) return { descendant: true, selectors: [{ t: "wildcard" }] };
      return { descendant: true, selectors: [{ t: "name", name: this.parseShorthandName() }] };
    }
    if (this.eat(".")) {
      if (this.eat("*")) return { descendant: false, selectors: [{ t: "wildcard" }] };
      return { descendant: false, selectors: [{ t: "name", name: this.parseShorthandName() }] };
    }
    if (this.peek() === "[") return { descendant: false, selectors: this.parseBracketed() };
    return null;
  }

  parseShorthandName(): string {
    const start = this.pos;
    if (!NAME_START.test(this.peek() ?? "")) this.fail("Expected a member name");
    while (this.pos < this.src.length && NAME_CHAR.test(this.src[this.pos])) this.pos++;
    return this.src.slice(start, this.pos);
  }

  parseBracketed(): Selector[] {
    this.expect("[");
    const selectors: Selector[] = [];
    for (;;) {
      this.ws();
      selectors.push(this.parseSelector());
      this.ws();
      if (this.eat(",")) continue;
      this.expect("]");
      return selectors;
    }
  }

  parseSelector(): Selector {
    const ch = this.peek();
    if (ch === "'" || ch === '"') return { t: "name", name: this.parseString() };
    if (ch === "*") {
      this.pos++;
      return { t: "wildcard" };
    }
    if (ch === "?") {
      this.pos++;
      this.ws();
      return { t: "filter", expr: this.parseOr() };
    }
    // index or slice
    const start = this.pos;
    const first = this.parseOptionalInt();
    this.ws();
    if (this.peek() === ":") {
      this.pos++;
      this.ws();
      const end = this.parseOptionalInt();
      this.ws();
      let step: number | null = null;
      if (this.eat(":")) {
        this.ws();
        step = this.parseOptionalInt();
      }
      return { t: "slice", start: first, end, step };
    }
    if (first === null) this.fail("Expected a selector", start);
    return { t: "index", index: first };
  }

  parseOptionalInt(): number | null {
    const m = /^-?(?:0|[1-9]\d*)/.exec(this.src.slice(this.pos));
    if (!m) return null;
    if (m[0] === "-0") this.fail('"-0" is not a valid index');
    const n = Number(m[0]);
    if (Math.abs(n) > MAX_INT) this.fail("Integer is out of range");
    this.pos += m[0].length;
    return n;
  }

  parseString(): string {
    const quote = this.src[this.pos++];
    let out = "";
    for (;;) {
      if (this.pos >= this.src.length) this.fail("Unterminated string");
      const ch = this.src[this.pos++];
      if (ch === quote) return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = this.src[this.pos++];
      switch (esc) {
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "n": out += "\n"; break;
        case "r": out += "\r"; break;
        case "t": out += "\t"; break;
        case "/": out += "/"; break;
        case "\\": out += "\\"; break;
        case "'": if (quote === "'") out += "'"; else this.fail("Invalid escape", this.pos - 1); break;
        case '"': if (quote === '"') out += '"'; else this.fail("Invalid escape", this.pos - 1); break;
        case "u": {
          const hex = this.src.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Invalid \\u escape", this.pos - 2);
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        default:
          this.fail("Invalid escape", this.pos - 1);
      }
    }
  }

  // ---- filter expressions ----

  parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      this.ws();
      if (!this.eat("||")) return left;
      this.ws();
      left = { t: "or", left, right: this.parseAnd() };
    }
  }

  parseAnd(): Expr {
    let left = this.parseUnary();
    for (;;) {
      this.ws();
      if (!this.eat("&&")) return left;
      this.ws();
      left = { t: "and", left, right: this.parseUnary() };
    }
  }

  parseUnary(): Expr {
    this.ws();
    if (this.peek() === "!") {
      this.pos++;
      this.ws();
      return { t: "not", operand: this.parseUnary() };
    }
    if (this.peek() === "(") {
      this.pos++;
      this.ws();
      const inner = this.parseOr();
      this.ws();
      this.expect(")");
      return inner;
    }
    return this.parseComparisonOrTest();
  }

  parseComparisonOrTest(): Expr {
    const left = this.parseOperand();
    this.ws();
    const op = (["==", "!=", "<=", ">=", "<", ">"] as const).find((o) => this.src.startsWith(o, this.pos));
    if (op) {
      this.pos += op.length;
      this.ws();
      const right = this.parseOperand();
      this.assertComparable(left);
      this.assertComparable(right);
      return { t: "cmp", op, left, right };
    }
    if (left.t === "query") return { t: "exists", query: left.query };
    if (left.t === "fn") return { t: "fn", call: left.call };
    return this.fail("A literal cannot be used on its own; compare it with something");
  }

  assertComparable(o: Operand) {
    if (o.t === "query" && !isSingular(o.query)) {
      this.fail("Only singular queries (names and indexes, no wildcards, slices, filters or ..) can be compared");
    }
  }

  parseOperand(): Operand {
    this.ws();
    const ch = this.peek();
    if (ch === "$" || ch === "@") return { t: "query", query: this.parseQuery() };
    if (ch === "'" || ch === '"') return { t: "lit", value: this.parseString() };
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
      const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
      if (!m) this.fail("Invalid number");
      this.pos += m[0].length;
      return { t: "lit", value: Number(m[0]) };
    }
    const m = /^[a-z][a-z0-9_]*/.exec(this.src.slice(this.pos));
    if (m) {
      const word = m[0];
      this.pos += word.length;
      if (word === "true") return { t: "lit", value: true };
      if (word === "false") return { t: "lit", value: false };
      if (word === "null") return { t: "lit", value: null };
      if (this.peek() === "(") return { t: "fn", call: this.parseFnCall(word) };
      this.fail(`Unknown word "${word}"`, this.pos - word.length);
    }
    return this.fail(`Unexpected ${ch === undefined ? "end of query" : `"${ch}"`} in filter`);
  }

  parseFnCall(name: string): FnCall {
    const spec = FUNCTIONS[name];
    if (!spec) this.fail(`Unknown function ${name}()`, this.pos - name.length);
    this.expect("(");
    const args: (Operand | Expr)[] = [];
    this.ws();
    if (!this.eat(")")) {
      for (;;) {
        this.ws();
        args.push(this.parseOperand());
        this.ws();
        if (this.eat(",")) continue;
        this.expect(")");
        break;
      }
    }
    if (args.length !== spec.arity) {
      this.fail(`${name}() takes ${spec.arity} argument${spec.arity === 1 ? "" : "s"}, got ${args.length}`);
    }
    return { name, args };
  }
}

function isSingular(q: Query): boolean {
  return q.segments.every(
    (s) => !s.descendant && s.selectors.length === 1 && (s.selectors[0].t === "name" || s.selectors[0].t === "index"),
  );
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

const NOTHING = Symbol("nothing");
type Value = unknown | typeof NOTHING;

export const MAX_RESULTS = 10_000;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

const FUNCTIONS: Record<string, { arity: number; run: (args: Value[]) => Value }> = {
  length: {
    arity: 1,
    run: ([v]) => {
      if (typeof v === "string") return [...v].length;
      if (Array.isArray(v)) return v.length;
      if (isObject(v)) return Object.keys(v).length;
      return NOTHING;
    },
  },
  count: { arity: 1, run: ([v]) => (v === NOTHING ? NOTHING : v) },
  value: { arity: 1, run: ([v]) => v },
  match: { arity: 2, run: ([s, re]) => regexTest(s, re, true) },
  search: { arity: 2, run: ([s, re]) => regexTest(s, re, false) },
};

function regexTest(subject: Value, pattern: Value, full: boolean): Value {
  if (typeof subject !== "string" || typeof pattern !== "string") return false;
  try {
    return new RegExp(full ? `^(?:${pattern})$` : pattern, "u").test(subject);
  } catch {
    return false;
  }
}

const memberPath = (parent: string, name: string) => `${parent}['${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`;

function normalizeSlice(len: number, start: number | null, end: number | null, step: number) {
  const norm = (i: number) => (i >= 0 ? i : len + i);
  const [lower, upper] =
    step >= 0
      ? [Math.min(Math.max(norm(start ?? 0), 0), len), Math.min(Math.max(norm(end ?? len), 0), len)]
      : [Math.min(Math.max(norm(end ?? -len - 1), -1), len - 1), Math.min(Math.max(norm(start ?? len - 1), -1), len - 1)];
  return { lower, upper };
}

class Evaluator {
  constructor(
    readonly root: unknown,
    readonly onNode: () => void,
  ) {}

  runQuery(query: Query, current: PathNode): PathNode[] {
    let nodes: PathNode[] = [query.root === "$" ? { value: this.root, path: "$" } : current];
    for (const segment of query.segments) {
      const next: PathNode[] = [];
      for (const node of nodes) {
        const inputs = segment.descendant ? this.descendants(node) : [node];
        for (const input of inputs) {
          for (const selector of segment.selectors) this.select(selector, input, next);
        }
      }
      nodes = next;
    }
    return nodes;
  }

  /** The node itself followed by all its descendants, in document order. */
  descendants(node: PathNode): PathNode[] {
    const out: PathNode[] = [];
    const walk = (n: PathNode) => {
      this.onNode();
      out.push(n);
      for (const child of this.children(n)) walk(child);
    };
    walk(node);
    return out;
  }

  children(node: PathNode): PathNode[] {
    const { value, path } = node;
    if (Array.isArray(value)) return value.map((v, i) => ({ value: v, path: `${path}[${i}]` }));
    if (isObject(value)) return Object.entries(value).map(([k, v]) => ({ value: v, path: memberPath(path, k) }));
    return [];
  }

  select(selector: Selector, node: PathNode, out: PathNode[]) {
    const { value, path } = node;
    switch (selector.t) {
      case "name":
        if (isObject(value) && Object.prototype.hasOwnProperty.call(value, selector.name)) {
          out.push({ value: value[selector.name], path: memberPath(path, selector.name) });
        }
        return;
      case "index":
        if (Array.isArray(value)) {
          const i = selector.index < 0 ? value.length + selector.index : selector.index;
          if (i >= 0 && i < value.length) out.push({ value: value[i], path: `${path}[${i}]` });
        }
        return;
      case "wildcard":
        out.push(...this.children(node));
        return;
      case "slice": {
        if (!Array.isArray(value)) return;
        const step = selector.step ?? 1;
        if (step === 0) return;
        const { lower, upper } = normalizeSlice(value.length, selector.start, selector.end, step);
        if (step > 0) for (let i = lower; i < upper; i += step) out.push({ value: value[i], path: `${path}[${i}]` });
        else for (let i = upper; lower < i; i += step) out.push({ value: value[i], path: `${path}[${i}]` });
        return;
      }
      case "filter":
        for (const child of this.children(node)) {
          this.onNode();
          if (this.truthy(selector.expr, child)) out.push(child);
        }
        return;
    }
  }

  truthy(expr: Expr, current: PathNode): boolean {
    switch (expr.t) {
      case "or":
        return this.truthy(expr.left, current) || this.truthy(expr.right, current);
      case "and":
        return this.truthy(expr.left, current) && this.truthy(expr.right, current);
      case "not":
        return !this.truthy(expr.operand, current);
      case "exists":
        return this.runQuery(expr.query, current).length > 0;
      case "fn": {
        const result = this.callFn(expr.call, current);
        return result === true;
      }
      case "cmp":
        return compare(expr.op, this.operand(expr.left, current), this.operand(expr.right, current));
    }
  }

  operand(o: Operand, current: PathNode): Value {
    if (o.t === "lit") return o.value;
    if (o.t === "query") {
      const nodes = this.runQuery(o.query, current);
      return nodes.length === 1 ? nodes[0].value : NOTHING;
    }
    return this.callFn(o.call, current);
  }

  callFn(call: FnCall, current: PathNode): Value {
    if (call.name === "count") {
      const arg = call.args[0];
      return arg.t === "query" ? this.runQuery(arg.query, current).length : NOTHING;
    }
    const args = call.args.map((a) => this.operand(a as Operand, current));
    return FUNCTIONS[call.name].run(args);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function compare(op: "==" | "!=" | "<" | "<=" | ">" | ">=", a: Value, b: Value): boolean {
  const eq = a === NOTHING || b === NOTHING ? a === b : deepEqual(a, b);
  if (op === "==") return eq;
  if (op === "!=") return !eq;
  const orderable =
    (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
  const lt = orderable && (a as number | string) < (b as number | string);
  if (op === "<") return lt;
  if (op === ">") return orderable && (b as number | string) < (a as number | string);
  if (op === "<=") return lt || eq;
  return (orderable && (b as number | string) < (a as number | string)) || eq;
}

/** Evaluate a JSONPath query. Throws JsonPathError on syntax errors or when too many nodes are visited. */
export function evaluateJsonPath(data: unknown, query: string): PathNode[] {
  const ast = new Parser(query).parseTopLevel();
  let visited = 0;
  const evaluator = new Evaluator(data, () => {
    if (++visited > 2_000_000) throw new JsonPathError("The query visits too many nodes; narrow it down");
  });
  const nodes = evaluator.runQuery(ast, { value: data, path: "$" });
  if (nodes.length > MAX_RESULTS) {
    throw new JsonPathError(`The query matched ${nodes.length} nodes; only ${MAX_RESULTS} can be shown. Narrow it down.`);
  }
  return nodes;
}
