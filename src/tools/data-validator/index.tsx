import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import type { Delimiter } from "../json-csv/logic";
import { validateAndFormat, type DataFormat } from "./logic";

export const TOOL_ID = "data-validator";

type InDelimiter = "auto" | "comma" | "semicolon" | "tab" | "pipe";
type OutDelimiter = "same" | "comma" | "semicolon" | "tab" | "pipe";
type IndentChoice = "2" | "4" | "tab";

interface State {
  input: string;
  format: DataFormat;
  indent: IndentChoice;
  minify: boolean;
  csvIn: InDelimiter;
  csvOut: OutDelimiter;
  csvPad: boolean;
}

const DEFAULTS: State = {
  input: "",
  format: "yaml",
  indent: "2",
  minify: false,
  csvIn: "auto",
  csvOut: "same",
  csvPad: false,
};

const DELIMITERS: Record<Exclude<InDelimiter, "auto">, Delimiter> = {
  comma: ",",
  semicolon: ";",
  tab: "\t",
  pipe: "|",
};

const FORMATS: { id: DataFormat; label: string; placeholder: string }[] = [
  { id: "yaml", label: "YAML", placeholder: "name: devbox\nitems:\n    - a\n    - b" },
  { id: "xml", label: "XML", placeholder: '<root><item id="1">a</item><item id="2">b</item></root>' },
  { id: "csv", label: "CSV", placeholder: "id,name\n1,Ann\n2,Bob" },
];

export default function DataValidatorTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    return validateAndFormat(state.format, state.input, {
      indent: state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
      minify: state.minify,
      csvDelimiter: state.csvIn === "auto" ? "auto" : DELIMITERS[state.csvIn],
      csvOutputDelimiter: state.csvOut === "same" ? "same" : DELIMITERS[state.csvOut],
      csvPad: state.csvPad,
    });
  }, [state.input, state.format, state.indent, state.minify, state.csvIn, state.csvOut, state.csvPad]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;
  const current = FORMATS.find((f) => f.id === state.format) ?? FORMATS[0];

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Format" className="segmented">
          {FORMATS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="btn-small"
              aria-pressed={state.format === id}
              onClick={() => update({ format: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {state.format !== "csv" && (
          <label>
            Indent{" "}
            <select
              value={state.format === "yaml" && state.indent === "tab" ? "2" : state.indent}
              onChange={(e) => update({ indent: e.target.value as IndentChoice })}
              disabled={state.format === "xml" && state.minify}
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              {state.format === "xml" && <option value="tab">Tab</option>}
            </select>
          </label>
        )}
        {state.format === "xml" && (
          <ToolbarSwitch label="Minify" checked={state.minify} onChange={(minify) => update({ minify })} />
        )}
        {state.format === "csv" && (
          <>
            <label>
              Delimiter{" "}
              <select value={state.csvIn} onChange={(e) => update({ csvIn: e.target.value as InDelimiter })}>
                <option value="auto">Auto-detect</option>
                <option value="comma">Comma (,)</option>
                <option value="semicolon">Semicolon (;)</option>
                <option value="tab">Tab</option>
                <option value="pipe">Pipe (|)</option>
              </select>
            </label>
            <label>
              Output delimiter{" "}
              <select value={state.csvOut} onChange={(e) => update({ csvOut: e.target.value as OutDelimiter })}>
                <option value="same">Same</option>
                <option value="comma">Comma (,)</option>
                <option value="semicolon">Semicolon (;)</option>
                <option value="tab">Tab</option>
                <option value="pipe">Pipe (|)</option>
              </select>
            </label>
            <ToolbarSwitch
              label="Pad short rows"
              checked={state.csvPad}
              onChange={(csvPad) => update({ csvPad })}
            />
          </>
        )}
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      {result?.ok && (
        <p className="status" aria-live="polite">
          ✓ {result.summary}
        </p>
      )}

      <div className="panes">
        <TextPane
          label={current.label}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={current.placeholder}
        />
        <TextPane
          label="Formatted"
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={`Invalid ${current.label}`} />
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
