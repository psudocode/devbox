import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { MODES, decodeUrl, encodeUrl, type UrlMode } from "./logic";

export const TOOL_ID = "url-encode";

interface State {
  input: string;
  direction: "encode" | "decode";
  mode: UrlMode;
}

const DEFAULTS: State = { input: "", direction: "encode", mode: "component" };

export default function UrlEncode() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => {
    if (state.input === "") return null;
    return state.direction === "encode" ? encodeUrl(state.input, state.mode) : decodeUrl(state.input, state.mode);
  }, [state.input, state.direction, state.mode]);

  const output = result?.ok ? result.text : "";
  const error = result && !result.ok ? result.error : null;
  const hint = MODES.find((m) => m.id === state.mode)?.hint;

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["encode", "decode"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className="btn-small"
              aria-pressed={state.direction === direction}
              onClick={() => update({ direction })}
            >
              {direction === "encode" ? "Encode" : "Decode"}
            </button>
          ))}
        </div>
        <label>
          Mode{" "}
          <select value={state.mode} onChange={(e) => update({ mode: e.target.value as UrlMode })}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-small"
          disabled={output === ""}
          onClick={() => update({ input: output, direction: state.direction === "encode" ? "decode" : "encode" })}
        >
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>
      <p className="status">{hint}</p>

      <div className="panes">
        <TextPane
          label="Input"
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={state.direction === "encode" ? "https://example.com/search?q=héllo wörld" : "h%C3%A9llo%20w%C3%B6rld"}
        />
        <TextPane label="Output" value={output} actions={<SendToMenu fromToolId={TOOL_ID} value={output} />} />
      </div>
      <ErrorDisplay error={error} title={state.direction === "encode" ? "Cannot encode" : "Cannot decode"} />
    </div>
  );
}
