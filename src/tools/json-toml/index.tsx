import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { jsonToToml, tomlToJson } from "./logic";

export const TOOL_ID = "json-toml";

type Mode = "json-to-toml" | "toml-to-json";
type IndentChoice = "2" | "4" | "tab" | "minify";

interface State {
  input: string;
  mode: Mode;
  indent: IndentChoice;
  sortKeys: boolean;
  /** JSON -> TOML: leave out null values (TOML has no null). */
  dropNulls: boolean;
}

const DEFAULTS: State = { input: "", mode: "json-to-toml", indent: "2", sortKeys: false, dropNulls: false };

export default function JsonTomlTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const toToml = state.mode === "json-to-toml";

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    if (state.mode === "json-to-toml") return jsonToToml(state.input, { dropNulls: state.dropNulls });
    return tomlToJson(state.input, {
      indent: state.indent === "minify" ? null : state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
      sortKeys: state.sortKeys,
    });
  }, [state.input, state.mode, state.indent, state.sortKeys, state.dropNulls]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: toToml ? "toml-to-json" : "json-to-toml" });

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["json-to-toml", "toml-to-json"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "json-to-toml" ? "JSON → TOML" : "TOML → JSON"}
            </button>
          ))}
        </div>
        {toToml ? (
          <ToolbarSwitch label="Drop nulls" checked={state.dropNulls} onChange={(dropNulls) => update({ dropNulls })} />
        ) : (
          <>
            <label>
              Output{" "}
              <select value={state.indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tab</option>
                <option value="minify">Minified</option>
              </select>
            </label>
            <ToolbarSwitch label="Sort keys" checked={state.sortKeys} onChange={(sortKeys) => update({ sortKeys })} />
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
          label={toToml ? "JSON" : "TOML"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={
            toToml ? '{"title": "devbox", "owner": {"name": "Ann"}}' : 'title = "devbox"\n\n[owner]\nname = "Ann"'
          }
        />
        <TextPane
          label={toToml ? "TOML" : "JSON"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={toToml ? "Cannot convert JSON" : "Invalid TOML"} />
    </div>
  );
}
