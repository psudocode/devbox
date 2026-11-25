import { useEffect, useState } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { processCode, type Action, type CodeResult, type Language } from "./logic";

export const TOOL_ID = "code-beautifier";

type IndentChoice = "2" | "4" | "tab";

interface State {
  input: string;
  language: Language;
  action: Action;
  indent: IndentChoice;
  blankLines: "0" | "1" | "2";
  mangle: boolean;
  compress: boolean;
  keepLicense: boolean;
  removeComments: boolean;
  minifyInline: boolean;
}

const DEFAULTS: State = {
  input: "",
  language: "js",
  action: "beautify",
  indent: "2",
  blankLines: "1",
  mangle: true,
  compress: true,
  keepLicense: false,
  removeComments: true,
  minifyInline: true,
};

const LANGUAGES: { id: Language; label: string; placeholder: string }[] = [
  { id: "html", label: "HTML", placeholder: "<div><p>Hello</p></div>" },
  { id: "css", label: "CSS", placeholder: "a{color:red;margin:0}" },
  { id: "js", label: "JavaScript", placeholder: "function add(a,b){return a+b}" },
];

/** 1234 -> "1.2 KB". */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function CodeBeautifierTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const [result, setResult] = useState<CodeResult | null>(null);
  const [busy, setBusy] = useState(false);

  const { input, language, action, indent, blankLines, mangle, compress, keepLicense, removeComments, minifyInline } = state;

  // The minifiers are loaded on first use and can take a moment on big inputs, so run them off the render path.
  useEffect(() => {
    if (input.trim() === "") {
      setResult(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      void processCode(language, action, input, {
        indent: indent === "tab" ? "tab" : indent === "4" ? 4 : 2,
        keepBlankLines: Number(blankLines),
        mangle,
        compress,
        keepLicenseComments: keepLicense,
        removeHtmlComments: removeComments,
        minifyInline,
      }).then((r) => {
        if (cancelled) return;
        setResult(r);
        setBusy(false);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, language, action, indent, blankLines, mangle, compress, keepLicense, removeComments, minifyInline]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;
  const current = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0];

  let summary: string | null = null;
  if (result?.ok) {
    const { inputBytes, outputBytes } = result;
    if (action === "minify") {
      const saved = inputBytes === 0 ? 0 : Math.round(((inputBytes - outputBytes) / inputBytes) * 100);
      summary = `${formatBytes(inputBytes)} → ${formatBytes(outputBytes)} (${saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`})`;
    } else {
      summary = `${formatBytes(inputBytes)} → ${formatBytes(outputBytes)}`;
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Language" className="segmented">
          {LANGUAGES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="btn-small"
              aria-pressed={language === id}
              onClick={() => update({ language: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Action" className="segmented">
          {(["beautify", "minify"] as const).map((a) => (
            <button key={a} type="button" className="btn-small" aria-pressed={action === a} onClick={() => update({ action: a })}>
              {a === "beautify" ? "Beautify" : "Minify"}
            </button>
          ))}
        </div>
        {action === "beautify" ? (
          <>
            <label>
              Indent{" "}
              <select value={indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tab</option>
              </select>
            </label>
            <label>
              Keep blank lines{" "}
              <select value={blankLines} onChange={(e) => update({ blankLines: e.target.value as State["blankLines"] })}>
                <option value="0">None</option>
                <option value="1">Up to 1</option>
                <option value="2">Up to 2</option>
              </select>
            </label>
          </>
        ) : (
          <>
            {language === "js" && (
              <>
                <ToolbarSwitch label="Mangle names" checked={mangle} onChange={(v) => update({ mangle: v })} />
                <ToolbarSwitch label="Compress" checked={compress} onChange={(v) => update({ compress: v })} />
              </>
            )}
            {language !== "html" && (
              <ToolbarSwitch label="Keep license comments" checked={keepLicense} onChange={(v) => update({ keepLicense: v })} />
            )}
            {language === "html" && (
              <>
                <ToolbarSwitch label="Remove comments" checked={removeComments} onChange={(v) => update({ removeComments: v })} />
                <ToolbarSwitch label="Minify inline JS / CSS" checked={minifyInline} onChange={(v) => update({ minifyInline: v })} />
              </>
            )}
          </>
        )}
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      {(summary || busy) && (
        <p className="status" aria-live="polite">
          {busy ? "Working…" : `✓ ${summary}`}
        </p>
      )}

      <div className="panes">
        <TextPane
          label={current.label}
          value={input}
          onChange={(value) => update({ input: value })}
          placeholder={current.placeholder}
        />
        <TextPane
          label={action === "beautify" ? "Beautified" : "Minified"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={`Cannot ${action} ${current.label}`} />
      {result?.ok && result.warnings.length > 0 && (
        <div role="status" className="status">
          <strong>Warnings</strong>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
