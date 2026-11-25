import { parseAllDocuments } from "yaml";
import { escapeField, parseCsvDetailed, type Delimiter } from "../json-csv/logic";
import { formatYamlError } from "../json-yaml/logic";
import { cleanParserMessage } from "../json-xml/logic";

export type DataFormat = "yaml" | "xml" | "csv";

export type Indent = 2 | 4 | "tab";

export interface FormatOptions {
  indent: Indent;
  /** XML: remove indentation and insignificant whitespace instead of pretty-printing. */
  minify: boolean;
  /** CSV: input delimiter, or "auto" to detect it. */
  csvDelimiter: Delimiter | "auto";
  /** CSV: output delimiter, or "same" to keep the input delimiter. */
  csvOutputDelimiter: Delimiter | "same";
  /** CSV: pad short rows with empty fields up to the widest row. */
  csvPad: boolean;
}

export type ValidateResult =
  | { ok: true; output: string; summary: string; warnings: string[] }
  | { ok: false; error: string };

/** Validate `text` as YAML, XML or CSV and return it re-formatted, with a short summary and any warnings. */
export function validateAndFormat(format: DataFormat, text: string, options: FormatOptions): ValidateResult {
  if (text.trim() === "") return { ok: false, error: "Input is empty." };
  switch (format) {
    case "yaml":
      return formatYaml(text, options);
    case "xml":
      return formatXml(text, options);
    case "csv":
      return formatCsv(text, options);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------------------------

function formatYaml(text: string, options: FormatOptions): ValidateResult {
  const docs = parseAllDocuments(text);
  const list = Array.isArray(docs) ? docs : [docs];

  for (const doc of list) {
    if (doc.errors[0]) return { ok: false, error: formatYamlError(doc.errors[0]) };
  }
  const warnings = list.flatMap((doc) => doc.warnings.map((w) => formatYamlError(w)));

  const indent = options.indent === "tab" ? 2 : options.indent;
  // A document that had an explicit `---` prints its own marker; drop it and join with a single one.
  const output = list
    .map((doc, i) => {
      const text = doc.toString({ indent, lineWidth: 0 }).replace(/\n+$/, "\n");
      return i === 0 ? text : text.replace(/^---[ \n]/, "");
    })
    .join("---\n");
  return {
    ok: true,
    output,
    summary: `Valid YAML · ${plural(list.length, "document")}`,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");

const TEXT = 3;
const CDATA = 4;
const PI = 7;
const COMMENT = 8;
const ELEMENT = 1;

const isBlankText = (n: Node) => n.nodeType === TEXT && (n.nodeValue ?? "").trim() === "";

/** `unit` is the indent string; null means "write everything on one line, no added whitespace". */
function serializeNode(node: Node, depth: number, unit: string | null): string {
  switch (node.nodeType) {
    case TEXT:
      return escapeText(node.nodeValue ?? "");
    case CDATA:
      return `<![CDATA[${node.nodeValue ?? ""}]]>`;
    case COMMENT:
      return `<!--${node.nodeValue ?? ""}-->`;
    case PI: {
      const pi = node as ProcessingInstruction;
      return pi.data ? `<?${pi.target} ${pi.data}?>` : `<?${pi.target}?>`;
    }
    case ELEMENT:
      return serializeElement(node as Element, depth, unit);
    default:
      return "";
  }
}

function serializeElement(el: Element, depth: number, unit: string | null): string {
  const pad = unit === null ? "" : unit.repeat(depth);
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${escapeAttr(a.value)}"`)
    .join("");
  const open = `<${el.nodeName}${attrs}`;
  const children = Array.from(el.childNodes);

  const hasText = children.some((c) => c.nodeType === CDATA || (c.nodeType === TEXT && !isBlankText(c)));
  const hasMarkup = children.some((c) => c.nodeType === ELEMENT || c.nodeType === COMMENT || c.nodeType === PI);

  // Text next to elements is "mixed content": whitespace is significant, so keep it exactly and stay on one line.
  if (hasText && hasMarkup) {
    return `${open}>${children.map((c) => serializeNode(c, 0, null)).join("")}</${el.nodeName}>`;
  }
  const significant = children.filter((c) => !isBlankText(c));
  if (significant.length === 0) return `${open}/>`;
  if (hasText || unit === null) {
    return `${open}>${significant.map((c) => serializeNode(c, 0, null)).join("")}</${el.nodeName}>`;
  }
  const inner = significant.map((c) => `${unit.repeat(depth + 1)}${serializeNode(c, depth + 1, unit)}`).join("\n");
  return `${open}>\n${inner}\n${pad}</${el.nodeName}>`;
}

function formatXml(text: string, options: FormatOptions): ValidateResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch (err) {
    return { ok: false, error: cleanParserMessage(err instanceof Error ? err.message : String(err)) };
  }
  const problem = doc.getElementsByTagName("parsererror")[0];
  if (problem) return { ok: false, error: cleanParserMessage(problem.textContent ?? "Invalid XML") };
  const root = doc.documentElement;
  if (!root) return { ok: false, error: "No root element found." };

  const warnings: string[] = [];
  const declaration = /^\s*(<\?xml\s[^?]*\?>)/.exec(text)?.[1] ?? null;
  const doctype = /<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>/i.exec(text)?.[0] ?? null;
  if (doctype?.includes("[")) warnings.push("The DOCTYPE internal subset is kept as written, not re-indented.");

  const unit = options.minify ? null : options.indent === "tab" ? "\t" : " ".repeat(options.indent);
  const parts: string[] = [];
  if (declaration) parts.push(declaration.replace(/\s+/g, " ").replace(/ \?>$/, "?>"));
  if (doctype) parts.push(doctype);
  for (const child of Array.from(doc.childNodes)) {
    if (child.nodeType === ELEMENT || child.nodeType === COMMENT || child.nodeType === PI) {
      parts.push(serializeNode(child, 0, unit));
    }
  }

  return {
    ok: true,
    output: parts.join(unit === null ? "" : "\n") + (unit === null ? "" : "\n"),
    summary: `Well-formed XML · root <${root.nodeName}> · ${plural(doc.getElementsByTagName("*").length, "element")}`,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------------

const CANDIDATES: Delimiter[] = [",", ";", "\t", "|"];
const DELIMITER_NAME: Record<Delimiter, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

/** Pick the delimiter that appears most often in the first non-empty line, outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === candidate && !quoted) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function formatCsv(text: string, options: FormatOptions): ValidateResult {
  const inDelimiter = options.csvDelimiter === "auto" ? detectDelimiter(text) : options.csvDelimiter;
  const outDelimiter = options.csvOutputDelimiter === "same" ? inDelimiter : options.csvOutputDelimiter;

  const parsed = parseCsvDetailed(text, inDelimiter);
  if (!parsed.ok) return parsed;
  const { rows, lines } = parsed;
  if (rows.length === 0) return { ok: false, error: "Input is empty." };

  const expected = rows[0].length;
  const widest = Math.max(...rows.map((r) => r.length));
  const warnings: string[] = [];
  const MAX_WARNINGS = 20;
  let ragged = 0;
  rows.forEach((row, i) => {
    if (row.length !== expected) {
      ragged++;
      if (warnings.length < MAX_WARNINGS) {
        warnings.push(`Line ${lines[i]}: ${plural(row.length, "field")}, the first row has ${expected}.`);
      }
    }
  });
  if (ragged > MAX_WARNINGS) warnings.push(`…and ${ragged - MAX_WARNINGS} more rows with a different number of fields.`);

  const output = rows
    .map((row) => {
      const cells = options.csvPad && row.length < widest ? [...row, ...Array<string>(widest - row.length).fill("")] : row;
      return cells.map((c) => escapeField(c, outDelimiter)).join(outDelimiter);
    })
    .join("\n");

  const columns = options.csvPad ? widest : expected;
  return {
    ok: true,
    output: `${output}\n`,
    summary: `${ragged === 0 ? "Valid" : "Parsed"} CSV · ${plural(rows.length, "row")} × ${plural(columns, "column")} · ${DELIMITER_NAME[inDelimiter]}-separated`,
    warnings,
  };
}
