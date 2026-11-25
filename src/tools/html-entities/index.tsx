import { useMemo } from "react";
import { SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { decodeEntities, encodeEntities, findUnknownEntities, type NumberFormat, type Scope } from "./logic";

export const TOOL_ID = "html-entities";

type Mode = "encode" | "decode";

interface State {
  input: string;
  mode: Mode;
  scope: Scope;
  format: NumberFormat;
  apos: boolean;
  upperHex: boolean;
}

const DEFAULTS: State = { input: "", mode: "encode", scope: "minimal", format: "named", apos: false, upperHex: false };

export default function HtmlEntitiesTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const output = useMemo(
    () =>
      state.mode === "encode"
        ? encodeEntities(state.input, { scope: state.scope, format: state.format, apos: state.apos, upperHex: state.upperHex })
        : decodeEntities(state.input),
    [state.input, state.mode, state.scope, state.format, state.apos, state.upperHex],
  );
  const unknown = useMemo(() => (state.mode === "decode" ? findUnknownEntities(state.input) : []), [state.mode, state.input]);

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: state.mode === "encode" ? "decode" : "encode" });
  const encoding = state.mode === "encode";

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
              {mode === "encode" ? "Encode" : "Decode"}
            </button>
          ))}
        </div>
        {encoding && (
          <>
            <label>
              Encode{" "}
              <select value={state.scope} onChange={(e) => update({ scope: e.target.value as Scope })}>
                <option value="minimal">Only &amp; &lt; &gt; " '</option>
                <option value="non-ascii">+ all non-ASCII</option>
                <option value="all">Everything but letters and digits</option>
              </select>
            </label>
            {state.scope !== "minimal" && (
              <label>
                Style{" "}
                <select value={state.format} onChange={(e) => update({ format: e.target.value as NumberFormat })}>
                  <option value="named">Names (&amp;copy;) where possible</option>
                  <option value="decimal">Decimal (&amp;#169;)</option>
                  <option value="hex">Hex (&amp;#xA9;)</option>
                </select>
              </label>
            )}
            {state.scope !== "minimal" && state.format === "hex" && (
              <ToolbarSwitch label="Upper-case hex" checked={state.upperHex} onChange={(upperHex) => update({ upperHex })} />
            )}
            <ToolbarSwitch label={"&apos; instead of &#39;"} checked={state.apos} onChange={(apos) => update({ apos })} />
          </>
        )}
        <button type="button" className="btn-small" onClick={swap} disabled={output === ""}>
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane
          label={encoding ? "Text" : "Text with entities"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={encoding ? '<p class="note">Tom & Jerry’s café — 5 € ©</p>' : "&lt;p&gt;Tom &amp; Jerry&rsquo;s caf&eacute; &mdash; 5 &euro; &copy;&lt;/p&gt;"}
        />
        <TextPane
          label={encoding ? "Encoded" : "Decoded"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      {unknown.length > 0 && (
        <p className="status status-bad" role="status">
          Not valid entities, left as written: {unknown.slice(0, 8).join(" ")}
          {unknown.length > 8 ? ` …and ${unknown.length - 8} more` : ""}
        </p>
      )}
    </div>
  );
}
