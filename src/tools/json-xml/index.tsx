import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { jsonToXml, xmlToJson, type Indent } from "./logic";

export const TOOL_ID = "json-xml";

type Mode = "json-to-xml" | "xml-to-json";
type IndentChoice = "2" | "4" | "tab" | "minify";

interface State {
  input: string;
  mode: Mode;
  indent: IndentChoice;
  /** JSON -> XML: add the <?xml ...?> declaration. */
  declaration: boolean;
  /** JSON -> XML: element name used when the JSON has no single top-level key. */
  rootName: string;
  /** XML -> JSON: convert numbers / booleans / null. */
  typed: boolean;
}

const DEFAULTS: State = {
  input: "",
  mode: "json-to-xml",
  indent: "2",
  declaration: false,
  rootName: "root",
  typed: false,
};

const toIndent = (choice: IndentChoice): Indent =>
  choice === "minify" ? null : choice === "tab" ? "tab" : choice === "4" ? 4 : 2;

export default function JsonXmlTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const toXml = state.mode === "json-to-xml";

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    const indent = toIndent(state.indent);
    if (state.mode === "json-to-xml") {
      return jsonToXml(state.input, {
        rootName: state.rootName.trim() || "root",
        indent,
        declaration: state.declaration,
      });
    }
    return xmlToJson(state.input, { indent, typed: state.typed });
  }, [state.input, state.mode, state.indent, state.declaration, state.rootName, state.typed]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: toXml ? "xml-to-json" : "json-to-xml" });

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["json-to-xml", "xml-to-json"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "json-to-xml" ? "JSON → XML" : "XML → JSON"}
            </button>
          ))}
        </div>
        <label>
          Output{" "}
          <select value={state.indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
            <option value="minify">Minified</option>
          </select>
        </label>
        {toXml ? (
          <>
            <ToolbarSwitch
              label="XML declaration"
              checked={state.declaration}
              onChange={(declaration) => update({ declaration })}
            />
            <label title="Used when the JSON has no single top-level key (arrays, scalars, several keys)">
              Root{" "}
              <input
                type="text"
                value={state.rootName}
                size={8}
                spellCheck={false}
                onChange={(e) => update({ rootName: e.target.value })}
              />
            </label>
          </>
        ) : (
          <ToolbarSwitch
            label="Detect numbers / booleans"
            checked={state.typed}
            onChange={(typed) => update({ typed })}
          />
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
          label={toXml ? "JSON" : "XML"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={
            toXml
              ? '{"user": {"@id": "1", "name": "Ann", "tags": {"tag": ["a", "b"]}}}'
              : '<user id="1">\n  <name>Ann</name>\n</user>'
          }
        />
        <TextPane
          label={toXml ? "XML" : "JSON"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={toXml ? "Cannot convert JSON" : "Cannot parse XML"} />
    </div>
  );
}
