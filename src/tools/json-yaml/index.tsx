import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { jsonToYaml, yamlToJson } from "./logic";

export const TOOL_ID = "json-yaml";

type Mode = "json-to-yaml" | "yaml-to-json";
type IndentChoice = "2" | "4" | "tab";

interface State {
  input: string;
  mode: Mode;
  indent: IndentChoice;
  sortKeys: boolean;
  minify: boolean;
}

const DEFAULTS: State = { input: "", mode: "json-to-yaml", indent: "2", sortKeys: false, minify: false };

export default function JsonYamlTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const toYaml = state.mode === "json-to-yaml";

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    if (state.mode === "json-to-yaml") {
      return jsonToYaml(state.input, { indent: state.indent === "4" ? 4 : 2, sortKeys: state.sortKeys });
    }
    return yamlToJson(state.input, {
      indent: state.minify ? null : state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
      sortKeys: state.sortKeys,
    });
  }, [state.input, state.mode, state.indent, state.sortKeys, state.minify]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: toYaml ? "yaml-to-json" : "json-to-yaml" });

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["json-to-yaml", "yaml-to-json"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "json-to-yaml" ? "JSON → YAML" : "YAML → JSON"}
            </button>
          ))}
        </div>
        <label>
          Indent{" "}
          <select
            value={toYaml && state.indent === "tab" ? "2" : state.indent}
            onChange={(e) => update({ indent: e.target.value as IndentChoice })}
            disabled={!toYaml && state.minify}
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            {!toYaml && <option value="tab">Tab</option>}
          </select>
        </label>
        <ToolbarSwitch label="Sort keys" checked={state.sortKeys} onChange={(sortKeys) => update({ sortKeys })} />
        {!toYaml && <ToolbarSwitch label="Minify" checked={state.minify} onChange={(minify) => update({ minify })} />}
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
          label={toYaml ? "JSON" : "YAML"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={toYaml ? '{"name": "devbox", "tags": ["a", "b"]}' : "name: devbox\ntags:\n  - a\n  - b"}
        />
        <TextPane
          label={toYaml ? "YAML" : "JSON"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={toYaml ? "Invalid JSON" : "Invalid YAML"} />
    </div>
  );
}
