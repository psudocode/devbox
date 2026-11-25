/**
 * JSON <-> XML using the common "badgerfish-lite" convention:
 *   - attributes are keys prefixed with "@"            {"a": {"@id": "1"}}      <a id="1"/>
 *   - mixed / text content next to attributes is "#text" {"a": {"@id": "1", "#text": "hi"}}
 *   - repeated elements are arrays                       {"a": {"b": [1, 2]}}     <a><b>1</b><b>2</b></a>
 *   - null is an empty element                           {"a": null}              <a/>
 * XML parsing uses the browser's DOMParser (no dependency); tests run it under jsdom.
 */

export type ConvertResult = { ok: true; output: string } | { ok: false; error: string };

export type Indent = 2 | 4 | "tab" | null;

export const ATTR_PREFIX = "@";
export const TEXT_KEY = "#text";

const NAME = /^[\p{L}_][\p{L}\p{N}_.-]*(?::[\p{L}_][\p{L}\p{N}_.-]*)?$/u;
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

class ConvertError extends Error {}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function escapeText(text: string): string {
  if (INVALID_XML_CHARS.test(text)) throw new ConvertError("A value contains a control character that XML cannot represent.");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
}

function assertName(name: string, kind: "element" | "attribute") {
  if (!NAME.test(name)) throw new ConvertError(`"${name}" is not a valid XML ${kind} name.`);
}

const scalarText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export interface JsonToXmlOptions {
  /** Used when the JSON has no single top-level key (arrays, scalars, several keys). */
  rootName: string;
  indent: Indent;
  declaration: boolean;
}

/** JSON text -> XML text. */
export function jsonToXml(json: string, options: JsonToXmlOptions): ConvertResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const unit = options.indent === null ? "" : options.indent === "tab" ? "\t" : " ".repeat(options.indent);
  const nl = options.indent === null ? "" : "\n";

  const write = (name: string, v: unknown, depth: number): string => {
    if (Array.isArray(v)) return v.map((item) => write(name, item, depth)).join(nl);
    assertName(name, "element");
    const pad = unit.repeat(depth);

    if (v === null || v === undefined) return `${pad}<${name}/>`;
    if (!isPlainObject(v)) return `${pad}<${name}>${escapeText(String(v))}</${name}>`;

    let attrs = "";
    let text: string | null = null;
    const children: string[] = [];
    for (const [key, child] of Object.entries(v)) {
      if (key.startsWith(ATTR_PREFIX)) {
        const attrName = key.slice(ATTR_PREFIX.length);
        assertName(attrName, "attribute");
        if (child !== null && typeof child === "object") {
          throw new ConvertError(`Attribute "${key}" must be a string, number, boolean or null.`);
        }
        attrs += ` ${attrName}="${escapeAttr(scalarText(child))}"`;
      } else if (key === TEXT_KEY) {
        if (child !== null && typeof child === "object") throw new ConvertError(`"${TEXT_KEY}" must be a scalar value.`);
        text = escapeText(scalarText(child));
      } else {
        children.push(write(key, child, depth + 1));
      }
    }

    if (children.length === 0) {
      return text ? `${pad}<${name}${attrs}>${text}</${name}>` : `${pad}<${name}${attrs}/>`;
    }
    const inner = text ? `${nl}${unit.repeat(depth + 1)}${text}` : "";
    return `${pad}<${name}${attrs}>${inner}${nl}${children.join(nl)}${nl}${pad}</${name}>`;
  };

  try {
    let body: string;
    const keys = isPlainObject(value) ? Object.keys(value) : [];
    if (isPlainObject(value) && keys.length === 1 && !keys[0].startsWith(ATTR_PREFIX) && keys[0] !== TEXT_KEY && !Array.isArray(value[keys[0]])) {
      body = write(keys[0], value[keys[0]], 0);
    } else if (Array.isArray(value)) {
      body = write(options.rootName, { item: value }, 0);
    } else {
      body = write(options.rootName, value, 0);
    }
    const declaration = options.declaration ? `<?xml version="1.0" encoding="UTF-8"?>${nl || "\n"}` : "";
    return { ok: true, output: declaration + body };
  } catch (err) {
    if (err instanceof ConvertError) return { ok: false, error: err.message };
    throw err;
  }
}

export interface XmlToJsonOptions {
  indent: Indent;
  /** Convert numbers, booleans (and null) in text and attributes. */
  typed: boolean;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function inferType(text: string): unknown {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (NUMBER.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && (!/^-?\d+$/.test(text) || Number.isSafeInteger(n))) return n;
  }
  return text;
}

/** XML text -> JSON text. Comments and processing instructions are dropped; CDATA becomes text. */
export function xmlToJson(xml: string, options: XmlToJsonOptions): ConvertResult {
  if (xml.trim() === "") return { ok: false, error: "Input is empty." };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch (err) {
    return { ok: false, error: cleanParserMessage(err instanceof Error ? err.message : String(err)) };
  }
  const problem = doc.getElementsByTagName("parsererror")[0];
  if (problem) return { ok: false, error: cleanParserMessage(problem.textContent ?? "Invalid XML") };
  const root = doc.documentElement;
  if (!root) return { ok: false, error: "No root element found." };

  const scalar = (text: string) => (options.typed ? inferType(text) : text);
  // Arrays we created for repeated elements (so an element whose own JSON value is an array is never confused with them).
  const repeated = new WeakSet<unknown[]>();

  const convert = (el: Element): unknown => {
    const obj: Record<string, unknown> = {};
    for (const attr of Array.from(el.attributes)) obj[ATTR_PREFIX + attr.name] = scalar(attr.value);

    let text = "";
    const children: Element[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 1) children.push(node as Element);
      else if (node.nodeType === 3 || node.nodeType === 4) text += node.nodeValue ?? "";
    }
    const hasAttrs = Object.keys(obj).length > 0;

    if (children.length === 0 && !hasAttrs) {
      const trimmed = text.trim();
      return trimmed === "" ? null : scalar(trimmed);
    }

    for (const child of children) {
      const converted = convert(child);
      const existing = obj[child.nodeName];
      if (existing === undefined && !(child.nodeName in obj)) obj[child.nodeName] = converted;
      else if (Array.isArray(existing) && repeated.has(existing)) existing.push(converted);
      else {
        const list = [existing, converted];
        repeated.add(list);
        obj[child.nodeName] = list;
      }
    }
    const trimmedText = text.trim();
    if (trimmedText !== "") obj[TEXT_KEY] = scalar(trimmedText);
    return obj;
  };

  const space = options.indent === null ? undefined : options.indent === "tab" ? "\t" : options.indent;
  return { ok: true, output: JSON.stringify({ [root.nodeName]: convert(root) }, null, space) };
}

export function cleanParserMessage(message: string): string {
  const lines = message
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Chrome/Firefox prefix the useful line with a generic title; jsdom puts "line:col" up front.
  const useful = lines.find((l) => /error|expected|unexpected|mismatch|line|column/i.test(l)) ?? lines[0] ?? "Invalid XML";
  return `Invalid XML: ${useful.replace(/^XML Parsing Error:\s*/i, "")}`;
}
