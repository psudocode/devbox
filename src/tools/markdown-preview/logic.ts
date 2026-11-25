import { Marked } from "marked";

export interface RenderOptions {
  /** GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks. */
  gfm: boolean;
  /** Treat a single newline as a line break. */
  breaks: boolean;
  /** Pass raw HTML in the Markdown through. Off: it is shown as literal text. */
  allowHtml: boolean;
}

export type RenderResult = { ok: true; html: string } | { ok: false; error: string };

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const IMAGE_SCHEMES = new Set(["http", "https"]);
const DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml)[;,]/i;

/**
 * Only allow URLs that cannot run code: relative URLs and a short list of schemes.
 * Browsers ignore tabs, newlines and control characters inside a scheme ("java\tscript:"), so strip them before checking.
 */
export function isSafeUrl(href: string, kind: "link" | "image"): boolean {
  // eslint-disable-next-line no-control-regex
  const compact = href.replace(/[\u0000- \u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme === undefined) return true; // relative, #anchor, //host handled by the browser as http(s)
  if (kind === "image" && scheme === "data") return DATA_IMAGE.test(compact);
  return (kind === "link" ? LINK_SCHEMES : IMAGE_SCHEMES).has(scheme);
}

/** Markdown -> HTML fragment. Unsafe URLs are dropped; raw HTML is escaped unless `allowHtml`. */
export function renderMarkdown(markdown: string, options: RenderOptions): RenderResult {
  const marked = new Marked({
    gfm: options.gfm,
    breaks: options.breaks,
    renderer: {
      html({ text }) {
        return options.allowHtml ? text : escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (!isSafeUrl(href, "link")) return inner;
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href)}"${t} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image({ href, title, text }) {
        if (!isSafeUrl(href, "image")) return escapeHtml(text);
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${t} loading="lazy" referrerpolicy="no-referrer">`;
      },
    },
  });
  try {
    return { ok: true, html: marked.parse(markdown, { async: false }) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DocumentOptions {
  dark: boolean;
  /** Let the preview load images over http(s). Off: only inline data: images show, and nothing is requested. */
  remoteImages: boolean;
}

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 1rem 1.25rem; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow-wrap: anywhere; }
body.light { background: #fff; color: #1f2328; }
body.dark { background: #1b1b1f; color: #e6e6e6; }
h1, h2 { padding-bottom: .3em; border-bottom: 1px solid rgba(128,128,128,.35); }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 .6em; line-height: 1.25; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
a { color: #0969da; } body.dark a { color: #58a6ff; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
code { background: rgba(128,128,128,.18); padding: .15em .35em; border-radius: 4px; }
pre { background: rgba(128,128,128,.14); padding: .85rem 1rem; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 4px solid rgba(128,128,128,.5); opacity: .85; }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow: auto; }
th, td { border: 1px solid rgba(128,128,128,.45); padding: .4em .75em; }
th { background: rgba(128,128,128,.14); }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid rgba(128,128,128,.4); margin: 1.5em 0; }
ul.contains-task-list, li > input[type="checkbox"] { list-style: none; }
`;

/** Complete HTML document for a sandboxed `<iframe srcdoc>`, with a Content-Security-Policy that blocks scripts and network access. */
export function buildPreviewDocument(bodyHtml: string, { dark, remoteImages }: DocumentOptions): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${remoteImages ? " https: http:" : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${STYLE}</style></head><body class="${dark ? "dark" : "light"}">${bodyHtml}</body></html>`;
}

export interface MarkdownStats {
  words: number;
  characters: number;
  readingMinutes: number;
  headings: { depth: number; text: string }[];
}

/** Word count, reading time (200 wpm) and the heading outline. Code blocks do not count as words. */
export function markdownStats(markdown: string): MarkdownStats {
  const withoutCode = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, " ");
  const words = (withoutCode.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const headings: MarkdownStats["headings"] = [];
  for (const token of new Marked().lexer(markdown)) {
    if (token.type === "heading") {
      headings.push({ depth: token.depth, text: token.text.replace(/[*_`~]/g, "").trim() });
    }
  }
  return {
    words,
    characters: markdown.length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 200)),
    headings,
  };
}
