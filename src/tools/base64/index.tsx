import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { decodeText, encodeText } from "./logic";

export const TOOL_ID = "base64";

type Mode = "encode" | "decode";

interface State {
  input: string;
  mode: Mode;
  urlSafe: boolean;
  padding: boolean;
}

const DEFAULTS: State = { input: "", mode: "encode", urlSafe: false, padding: true };

export default function Base64Tool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => {
    if (state.input === "") return null;
    if (state.mode === "encode") {
      return { ok: true as const, text: encodeText(state.input, { urlSafe: state.urlSafe, padding: state.padding }) };
    }
    return decodeText(state.input);
  }, [state.input, state.mode, state.urlSafe, state.padding]);

  const output = result?.ok ? result.text : "";
  const error = result && !result.ok ? result.error : null;

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: state.mode === "encode" ? "decode" : "encode" });

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
        {state.mode === "encode" && (
          <>
            <label>
              <input type="checkbox" checked={state.urlSafe} onChange={(e) => update({ urlSafe: e.target.checked })} /> URL-safe
              (- and _)
            </label>
            <label>
              <input type="checkbox" checked={state.padding} onChange={(e) => update({ padding: e.target.checked })} /> Padding
              (=)
            </label>
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
          label={state.mode === "encode" ? "Text" : "Base64"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={state.mode === "encode" ? "Text to encode" : "SGVsbG8gd29ybGQ="}
        />
        <TextPane
          label={state.mode === "encode" ? "Base64" : "Text"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title="Cannot decode" />
    </div>
  );
}
