import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { byteSize } from "./size";
import { useToolState } from "../../lib/useToolState";
import { usePipelineInput } from "../../lib/usePipeline";
import { formatError, formatJson, type Indent } from "./logic";

export const TOOL_ID = "json-formatter";

type Mode = "prettify" | "minify";

interface State {
  input: string;
  mode: Mode;
  indent: "2" | "4" | "tab";
  sortKeys: boolean;
}

const DEFAULTS: State = { input: "", mode: "prettify", indent: "2", sortKeys: false };

const toIndent = (value: State["indent"]): Indent => (value === "tab" ? "tab" : value === "4" ? 4 : 2);

export default function JsonFormatter() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(
    () =>
      state.input.trim() === ""
        ? null
        : formatJson(state.input, {
            indent: state.mode === "minify" ? null : toIndent(state.indent),
            sortKeys: state.sortKeys,
          }),
    [state.input, state.mode, state.indent, state.sortKeys],
  );

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? formatError(result.error) : null;

  return (
    <div>
      <div className="toolbar">
        <label>
          Mode{" "}
          <select value={state.mode} onChange={(e) => update({ mode: e.target.value as Mode })}>
            <option value="prettify">Prettify</option>
            <option value="minify">Minify</option>
          </select>
        </label>
        {state.mode === "prettify" && (
          <label>
            Indent{" "}
            <select value={state.indent} onChange={(e) => update({ indent: e.target.value as State["indent"] })}>
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tab</option>
            </select>
          </label>
        )}
        <ToolbarSwitch
          label="Sort keys"
          checked={state.sortKeys}
          onChange={(sortKeys) => update({ sortKeys })}
        />
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <p className={error ? "status status-bad" : "status"} aria-live="polite">
        {result === null
          ? "Paste JSON to format it."
          : error
            ? "Invalid JSON"
            : `Valid JSON · ${byteSize(state.input)} → ${byteSize(output)}`}
      </p>

      <div className="panes">
        <TextPane
          label="Input"
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder='{"hello": "world"}'
        />
        <TextPane
          label="Output"
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title="Invalid JSON" />
    </div>
  );
}
