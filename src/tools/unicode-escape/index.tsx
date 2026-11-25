import { useMemo } from "react";
import { SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { decodeUnicode, describeText, encodeUnicode, type Scope, type Style } from "./logic";

export const TOOL_ID = "unicode-escape";

type Mode = "encode" | "decode";
type DecodeAs = "auto" | "css";

interface State {
  input: string;
  mode: Mode;
  style: Style;
  scope: Scope;
  escapeBackslash: boolean;
  upper: boolean;
  decodeAs: DecodeAs;
}

const DEFAULTS: State = {
  input: "",
  mode: "encode",
  style: "js",
  scope: "non-ascii",
  escapeBackslash: true,
  upper: false,
  decodeAs: "auto",
};

const STYLES: { id: Style; label: string }[] = [
  { id: "js", label: "\\uXXXX (JavaScript, Java, JSON, C#)" },
  { id: "es6", label: "\\u{X} (ES6)" },
  { id: "python", label: "\\uXXXX / \\UXXXXXXXX (Python, C)" },
  { id: "css", label: "\\XXXX (CSS)" },
  { id: "codepoint", label: "U+XXXX (code points)" },
  { id: "percent-u", label: "%uXXXX (legacy escape())" },
];

export default function UnicodeEscapeTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const encoding = state.mode === "encode";
  const decoded = useMemo(
    () => (encoding ? null : decodeUnicode(state.input, state.decodeAs)),
    [encoding, state.input, state.decodeAs],
  );
  const output = encoding
    ? encodeUnicode(state.input, {
        style: state.style,
        scope: state.scope,
        escapeBackslash: state.escapeBackslash,
        upper: state.upper,
      })
    : (decoded?.text ?? "");
  const facts = useMemo(() => describeText(encoding ? state.input : output), [encoding, state.input, output]);

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: encoding ? "decode" : "encode" });
  const backslashStyle = state.style === "js" || state.style === "es6" || state.style === "python";

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Mode" className="segmented">
          {(["encode", "decode"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "encode" ? "Escape" : "Unescape"}
            </button>
          ))}
        </div>
        {encoding ? (
          <>
            <label>
              Style{" "}
              <select value={state.style} onChange={(e) => update({ style: e.target.value as Style })}>
                {STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Escape{" "}
              <select value={state.scope} onChange={(e) => update({ scope: e.target.value as Scope })}>
                <option value="non-ascii">Non-ASCII only</option>
                <option value="all">Every character</option>
              </select>
            </label>
            {backslashStyle && state.scope === "non-ascii" && (
              <ToolbarSwitch
                label="Escape backslashes"
                checked={state.escapeBackslash}
                onChange={(escapeBackslash) => update({ escapeBackslash })}
              />
            )}
            <ToolbarSwitch label="Upper-case hex" checked={state.upper} onChange={(upper) => update({ upper })} />
          </>
        ) : (
          <label>
            Format{" "}
            <select value={state.decodeAs} onChange={(e) => update({ decodeAs: e.target.value as DecodeAs })}>
              <option value="auto">Auto (\u \U \x U+ %u \n …)</option>
              <option value="css">CSS (\E9 )</option>
            </select>
          </label>
        )}
        <button type="button" className="btn-small" onClick={swap} disabled={output === ""}>
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      {state.input !== "" && (
        <p className="status" aria-live="polite">
          {encoding ? "Text" : "Decoded text"}: {facts.codePoints} code point{facts.codePoints === 1 ? "" : "s"} · {facts.utf16Units}{" "}
          UTF-16 unit{facts.utf16Units === 1 ? "" : "s"} · {facts.utf8Bytes} UTF-8 byte{facts.utf8Bytes === 1 ? "" : "s"}
          {facts.astral > 0 ? ` · ${facts.astral} outside the BMP (surrogate pair${facts.astral === 1 ? "" : "s"} in UTF-16)` : ""}
          {!encoding && decoded ? ` · ${decoded.count} escape${decoded.count === 1 ? "" : "s"} decoded` : ""}
        </p>
      )}

      <div className="panes">
        <TextPane
          label={encoding ? "Text" : "Escaped text"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={encoding ? "café — 日本語 🐙" : "caf\\u00e9 \\u2014 \\u65e5\\u672c\\u8a9e \\u{1F419}"}
        />
        <TextPane
          label={encoding ? "Escaped" : "Text"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      {decoded && decoded.warnings.length > 0 && (
        <div role="status" className="status status-bad">
          <ul>
            {decoded.warnings.slice(0, 5).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
