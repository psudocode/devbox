/**
 * A conservative HTML minifier: it only removes whitespace that cannot change how the page renders
 * (runs of whitespace collapse to one space, whitespace next to block-level tags goes away), drops comments,
 * and leaves <pre> / <textarea> untouched. <script> and <style> bodies are passed to `minifyInline`.
 */

const TOKEN = new RegExp(
  [
    String.raw`<!--[\s\S]*?-->`,
    String.raw`<!\[CDATA\[[\s\S]*?\]\]>`,
    // raw-text and whitespace-sensitive elements, kept as one token: <script ...>...</script>
    String.raw`<(script|style|pre|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>`,
    // any other tag or doctype; quoted attribute values may contain ">"
    String.raw`<!?\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>`,
    String.raw`[^<]+`,
    "<",
  ].join("|"),
  "gi",
);

/** Elements around which whitespace is insignificant. */
const BLOCK = new Set(
  (
    "html head body title meta link base style script noscript template div p ul ol li dl dt dd table caption colgroup col " +
    "thead tbody tfoot tr td th form fieldset legend h1 h2 h3 h4 h5 h6 section article aside header footer nav main " +
    "figure figcaption blockquote hr br address details summary select option optgroup datalist pre textarea " +
    "iframe object embed video audio canvas"
  ).split(" "),
);

type Kind = "comment" | "block" | "tag" | "text";

interface Token {
  kind: Kind;
  text: string;
  /** Lower-case tag name for kind "tag" / "block". */
  name?: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  for (const match of html.matchAll(TOKEN)) {
    const text = match[0];
    if (text.startsWith("<!--")) tokens.push({ kind: "comment", text });
    else if (text.startsWith("<![CDATA[")) tokens.push({ kind: "tag", text });
    else if (match[1]) tokens.push({ kind: "block", text, name: match[1].toLowerCase() });
    else if (text.length > 1 && text.startsWith("<") && (text[1] === "!" || /[a-zA-Z/]/.test(text[1]))) {
      tokens.push({ kind: "tag", text, name: /^<\/?([a-zA-Z][^\s/>]*)/.exec(text)?.[1]?.toLowerCase() });
    } else tokens.push({ kind: "text", text });
  }
  return tokens;
}

/** Collapse whitespace between attributes without touching quoted values. */
function tidyTag(tag: string): string {
  return tag
    .replace(/("[^"]*"|'[^']*')|\s+/g, (_m, quoted: string | undefined) => quoted ?? " ")
    .replace(/\s+(\/?>)$/, "$1");
}

const isBoundary = (t: Token | undefined) =>
  t === undefined || t.kind === "block" || t.kind === "comment" || (t.kind === "tag" && (t.name === undefined || BLOCK.has(t.name)));

export interface HtmlMinifyOptions {
  removeComments: boolean;
  /** Receives the body of a <script> or <style> element; return the minified body, or throw to keep the original. */
  minifyInline: ((kind: "js" | "css", code: string) => Promise<string>) | null;
}

const SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

function attr(openTag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(openTag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

export async function minifyHtml(html: string, options: HtmlMinifyOptions): Promise<{ output: string; warnings: string[] }> {
  const tokens = tokenize(html);
  const warnings: string[] = [];
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.kind) {
      case "comment": {
        // Keep IE conditional comments; they are not comments to the browser that reads them.
        if (!options.removeComments || /^<!--\s*\[if\b/i.test(token.text) || /<!\[endif\]\s*-->$/i.test(token.text)) {
          out.push(token.text);
        }
        break;
      }
      case "block": {
        if ((token.name === "script" || token.name === "style") && options.minifyInline) {
          out.push(await minifyBlock(token, options.minifyInline, warnings));
        } else if (token.name === "script" || token.name === "style") {
          const open = /^<[^>]*>/.exec(token.text);
          out.push(open ? tidyTag(open[0]) + token.text.slice(open[0].length) : token.text);
        } else {
          out.push(token.text); // pre / textarea: verbatim
        }
        break;
      }
      case "tag":
        out.push(tidyTag(token.text));
        break;
      case "text": {
        let text = token.text.replace(/\s+/g, " ");
        if (isBoundary(tokens[i - 1])) text = text.trimStart();
        if (isBoundary(tokens[i + 1])) text = text.trimEnd();
        out.push(text);
        break;
      }
    }
  }
  return { output: out.join("").trim(), warnings };
}

async function minifyBlock(
  token: Token,
  minify: NonNullable<HtmlMinifyOptions["minifyInline"]>,
  warnings: string[],
): Promise<string> {
  const open = /^<(?:"[^"]*"|'[^']*'|[^'">])*>/.exec(token.text)?.[0] ?? "";
  const closeMatch = /<\/(?:script|style)\s*>$/i.exec(token.text);
  if (!open || !closeMatch) return token.text;
  const body = token.text.slice(open.length, closeMatch.index);
  const close = closeMatch[0];
  const type = (attr(open, "type") ?? "").trim().toLowerCase();

  const isScript = token.name === "script";
  const supported = isScript ? SCRIPT_TYPES.has(type) : type === "" || type === "text/css";
  if (!supported || body.trim() === "") return tidyTag(open) + body + close;

  try {
    return tidyTag(open) + (await minify(isScript ? "js" : "css", body)) + close;
  } catch (err) {
    const what = isScript ? "<script>" : "<style>";
    warnings.push(`Left an inline ${what} unchanged: ${err instanceof Error ? err.message : String(err)}`);
    return tidyTag(open) + body + close;
  }
}
