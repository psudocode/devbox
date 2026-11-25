import { minifyHtml } from "./html-minify";

export type Language = "html" | "css" | "js";
export type Action = "beautify" | "minify";

export interface Options {
  indent: 2 | 4 | "tab";
  /** Beautify: maximum number of blank lines to keep between statements / rules (0 = remove all). */
  keepBlankLines: number;
  /** Minify JS: shorten local variable and function names. */
  mangle: boolean;
  /** Minify JS: apply code transformations (dead code removal, constant folding, ...). */
  compress: boolean;
  /** Minify: keep bang comments (the ones starting with an exclamation mark) and @license / @preserve comments. */
  keepLicenseComments: boolean;
  /** Minify HTML: remove comments (conditional comments are always kept). */
  removeHtmlComments: boolean;
  /** Minify HTML: also minify the inline <script> and <style> bodies. */
  minifyInline: boolean;
}

export type CodeResult =
  | { ok: true; output: string; inputBytes: number; outputBytes: number; warnings: string[] }
  | { ok: false; error: string };

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Beautify or minify HTML, CSS or JavaScript. Heavy libraries are loaded on first use. */
export async function processCode(language: Language, action: Action, source: string, options: Options): Promise<CodeResult> {
  if (source.trim() === "") return { ok: false, error: "Input is empty." };
  try {
    const { output, warnings } =
      action === "beautify" ? await beautify(language, source, options) : await minify(language, source, options);
    return { ok: true, output, inputBytes: byteLength(source), outputBytes: byteLength(output), warnings };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

interface Processed {
  output: string;
  warnings: string[];
}

async function beautify(language: Language, source: string, options: Options): Promise<Processed> {
  const { default: beautifier } = await import("js-beautify/js/lib/beautifier.js");
  const common = {
    indent_size: options.indent === "tab" ? 1 : options.indent,
    indent_char: options.indent === "tab" ? "\t" : " ",
    indent_with_tabs: options.indent === "tab",
    end_with_newline: true,
    preserve_newlines: options.keepBlankLines > 0,
    // js-beautify counts line breaks, not blank lines: N blank lines in a row are N + 1 line breaks.
    max_preserve_newlines: Math.max(options.keepBlankLines, 0) + 1,
  };
  switch (language) {
    case "js":
      return { output: beautifier.js(source, { ...common, brace_style: "collapse" }), warnings: [] };
    case "css":
      return { output: beautifier.css(source, { ...common, newline_between_rules: true }), warnings: [] };
    case "html":
      // end_with_newline also applies to embedded <script> / <style> bodies and leaves a blank line before their closing tag,
      // so turn it off for the formatter and add the final newline ourselves.
      return {
        output: `${beautifier
          .html(source, {
            ...common,
            end_with_newline: false,
            wrap_line_length: 0,
            indent_inner_html: false,
            content_unformatted: ["pre", "textarea"],
          })
          .replace(/\s+$/, "")}\n`,
        warnings: [],
      };
  }
}

async function minify(language: Language, source: string, options: Options): Promise<Processed> {
  switch (language) {
    case "js":
      return { output: await minifyJs(source, options), warnings: [] };
    case "css":
      return minifyCss(source, options);
    case "html":
      return minifyHtml(source, {
        removeComments: options.removeHtmlComments,
        minifyInline: options.minifyInline
          ? async (kind, code) => {
              if (kind === "js") return minifyJs(code, options);
              const css = await minifyCss(code, options);
              if (css.warnings.length > 0) throw new Error(css.warnings[0]);
              return css.output;
            }
          : null,
      });
  }
}

async function minifyJs(source: string, options: Options): Promise<string> {
  const { minify: terserMinify } = await import("terser");
  const result = await terserMinify(source, {
    compress: options.compress,
    mangle: options.mangle,
    format: { comments: options.keepLicenseComments ? /^!|@license|@preserve|@cc_on/i : false },
  });
  return result.code ?? "";
}

async function minifyCss(source: string, options: Options): Promise<Processed> {
  const csso = await import("csso");
  const warnings: string[] = [];
  // csso is forgiving and silently drops what it cannot parse; surface that instead of hiding it.
  csso.syntax.parse(source, {
    onParseError(error: { message: string; line?: number; column?: number }) {
      if (warnings.length < 10) warnings.push(`line ${error.line ?? "?"}, column ${error.column ?? "?"}: ${error.message}`);
    },
  });
  const result = csso.minify(source, { comments: options.keepLicenseComments ? "exclamation" : false });
  return { output: result.css, warnings };
}

interface PositionedError {
  message?: string;
  line?: number;
  col?: number;
}

function describeError(err: unknown): string {
  // terser throws a JS_Parse_Error with line / col
  const e = err as PositionedError;
  if (e && typeof e === "object" && typeof e.line === "number" && typeof e.message === "string") {
    return `line ${e.line}${typeof e.col === "number" ? `, column ${e.col + 1}` : ""}: ${e.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
