/** JSON <-> CSV (RFC 4180 style). Pure functions, no dependencies. */

export type Delimiter = "," | ";" | "\t" | "|";

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string };

type Row = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);

/** Join nested paths with dots: {a:{b:1}} -> {"a.b":1}. Arrays and empty objects are kept as JSON text. */
export function flattenRow(value: unknown, prefix = "", out: Row = {}): Row {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flattenRow(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Quote a field when it contains the delimiter, a quote, a newline, or edges with whitespace. */
export function escapeField(text: string, delimiter: Delimiter): string {
  if (text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface JsonToCsvOptions {
  delimiter: Delimiter;
  /** Flatten nested objects into dotted columns (a.b). Otherwise nested values are written as JSON text. */
  flatten: boolean;
  header: boolean;
  /** Line ending of the output. */
  eol: "\n" | "\r\n";
}

/** JSON array of objects (or arrays, or a single object) -> CSV. Columns are the union of all keys, in first-seen order. */
export function jsonToCsv(json: string, options: JsonToCsvOptions): ConvertResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) return { ok: true, output: "" };

  const { delimiter, eol } = options;
  const lines: string[] = [];

  // Array of arrays -> plain rows, no header.
  if (items.every(Array.isArray)) {
    for (const row of items as unknown[][]) {
      lines.push(row.map((cell) => escapeField(cellText(cell), delimiter)).join(delimiter));
    }
    return { ok: true, output: lines.join(eol) };
  }

  const rows: Row[] = [];
  for (const [i, item] of items.entries()) {
    if (!isPlainObject(item)) {
      return {
        ok: false,
        error: `Item ${i} is ${item === null ? "null" : Array.isArray(item) ? "an array" : `a ${typeof item}`}; expected an array of objects.`,
      };
    }
    rows.push(options.flatten ? flattenRow(item) : item);
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  if (options.header) lines.push(columns.map((c) => escapeField(c, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(cellText(row[c]), delimiter)).join(delimiter));
  }
  return { ok: true, output: lines.join(eol) };
}

export type ParseCsvResult = { ok: true; rows: string[][] } | { ok: false; error: string };

/** RFC 4180 parser: quoted fields, escaped quotes (""), newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string, delimiter: Delimiter): ParseCsvResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let line = 1;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    // Blank lines are skipped.
    if (row.length === 0 && field === "" && !fieldStarted) return;
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          const next = src[i + 1];
          if (next !== undefined && next !== delimiter && next !== "\n" && next !== "\r") {
            return { ok: false, error: `Line ${line}: unexpected ${JSON.stringify(next)} after a closing quote.` };
          }
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"') {
      if (fieldStarted) return { ok: false, error: `Line ${line}: a quote in the middle of an unquoted field.` };
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      line++;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) return { ok: false, error: `Line ${line}: a quoted field is never closed.` };
  if (field !== "" || fieldStarted || row.length > 0) endRow();
  return { ok: true, rows };
}

export interface CsvToJsonOptions {
  delimiter: Delimiter;
  /** First row holds column names; output is an array of objects. Otherwise an array of arrays. */
  header: boolean;
  /** Turn "1", "2.5", "true", "false", "null" into numbers / booleans / null. Leading-zero numbers stay text. */
  typed: boolean;
  /** Expand dotted column names (a.b) back into nested objects. */
  unflatten: boolean;
  indent: 2 | 4 | "tab" | null;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Convert a CSV cell to a typed JSON value. Integers beyond the safe range stay strings so no digits are lost. */
export function inferType(cell: string): unknown {
  if (cell === "true") return true;
  if (cell === "false") return false;
  if (cell === "null") return null;
  if (NUMBER.test(cell)) {
    const n = Number(cell);
    if (Number.isFinite(n) && (!/^-?\d+$/.test(cell) || Number.isSafeInteger(n))) return n;
  }
  return cell;
}

function setPath(target: Row, path: string, value: unknown) {
  const parts = path.split(".");
  let node = target;
  for (const [i, part] of parts.entries()) {
    if (i === parts.length - 1) {
      node[part] = value;
    } else {
      if (!isPlainObject(node[part])) node[part] = {};
      node = node[part] as Row;
    }
  }
}

export function csvToJson(csv: string, options: CsvToJsonOptions): ConvertResult {
  const parsed = parseCsv(csv, options.delimiter);
  if (!parsed.ok) return parsed;
  const convert = (cell: string) => (options.typed ? inferType(cell) : cell);
  const space = options.indent === null ? undefined : options.indent === "tab" ? "\t" : options.indent;

  let data: unknown;
  if (!options.header) {
    data = parsed.rows.map((row) => row.map(convert));
  } else {
    const [head, ...body] = parsed.rows;
    if (!head) return { ok: true, output: "[]" };
    const names = head.map((name, i) => (name === "" ? `column${i + 1}` : name));
    const dupe = names.find((name, i) => names.indexOf(name) !== i);
    if (dupe !== undefined) return { ok: false, error: `Duplicate column name "${dupe}" in the header row.` };
    data = body.map((row) => {
      const obj: Row = {};
      names.forEach((name, i) => {
        const cell = row[i] ?? "";
        if (options.unflatten) setPath(obj, name, convert(cell));
        else obj[name] = convert(cell);
      });
      return obj;
    });
  }
  return { ok: true, output: JSON.stringify(data, null, space) };
}
