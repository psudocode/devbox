import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { csvToJson, jsonToCsv, type Delimiter } from "./logic";

export const TOOL_ID = "json-csv";

type Mode = "json-to-csv" | "csv-to-json";
type DelimiterChoice = "comma" | "semicolon" | "tab" | "pipe";
type IndentChoice = "2" | "4" | "tab" | "minify";

interface State {
  input: string;
  mode: Mode;
  delimiter: DelimiterChoice;
  header: boolean;
  /** JSON -> CSV: flatten nested objects. CSV -> JSON: expand dotted column names. */
  nested: boolean;
  /** CSV -> JSON: convert numbers / booleans / null. */
  typed: boolean;
  indent: IndentChoice;
}

const DEFAULTS: State = {
  input: "",
  mode: "json-to-csv",
  delimiter: "comma",
  header: true,
  nested: true,
  typed: true,
  indent: "2",
};

const DELIMITERS: Record<DelimiterChoice, Delimiter> = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };

export default function JsonCsvTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const toCsv = state.mode === "json-to-csv";
  const delimiter = DELIMITERS[state.delimiter] ?? ",";

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    if (state.mode === "json-to-csv") {
      return jsonToCsv(state.input, { delimiter, flatten: state.nested, header: state.header, eol: "\n" });
    }
    return csvToJson(state.input, {
      delimiter,
      header: state.header,
      typed: state.typed,
      unflatten: state.nested,
      indent: state.indent === "minify" ? null : state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
    });
  }, [state.input, state.mode, delimiter, state.header, state.nested, state.typed, state.indent]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: toCsv ? "csv-to-json" : "json-to-csv" });

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["json-to-csv", "csv-to-json"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "json-to-csv" ? "JSON → CSV" : "CSV → JSON"}
            </button>
          ))}
        </div>
        <label>
          Delimiter{" "}
          <select
            value={state.delimiter}
            onChange={(e) => update({ delimiter: e.target.value as DelimiterChoice })}
          >
            <option value="comma">Comma (,)</option>
            <option value="semicolon">Semicolon (;)</option>
            <option value="tab">Tab</option>
            <option value="pipe">Pipe (|)</option>
          </select>
        </label>
        <ToolbarSwitch label="Header row" checked={state.header} onChange={(header) => update({ header })} />
        <ToolbarSwitch
          label={toCsv ? "Flatten nested (a.b)" : "Expand a.b into objects"}
          checked={state.nested}
          onChange={(nested) => update({ nested })}
        />
        {!toCsv && (
          <>
            <ToolbarSwitch
              label="Detect numbers / booleans"
              checked={state.typed}
              onChange={(typed) => update({ typed })}
            />
            <label>
              Output{" "}
              <select value={state.indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tab</option>
                <option value="minify">Minified</option>
              </select>
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
          label={toCsv ? "JSON" : "CSV"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={toCsv ? '[{"id": 1, "name": "Ann"}, {"id": 2, "name": "Bob"}]' : "id,name\n1,Ann\n2,Bob"}
        />
        <TextPane
          label={toCsv ? "CSV" : "JSON"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={toCsv ? "Cannot convert JSON" : "Cannot parse CSV"} />
    </div>
  );
}
