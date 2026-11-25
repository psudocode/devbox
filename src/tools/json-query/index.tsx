import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { runQuery, type Engine } from "./logic";

export const TOOL_ID = "json-query";

type IndentChoice = "2" | "4" | "tab" | "minify";

interface State {
  input: string;
  engine: Engine;
  /** Each engine keeps its own query so switching does not lose it. */
  jsonpath: string;
  jq: string;
  output: "values" | "paths" | "both";
  raw: boolean;
  indent: IndentChoice;
}

const DEFAULTS: State = {
  input: "",
  engine: "jsonpath",
  jsonpath: "$..",
  jq: ".",
  output: "values",
  raw: false,
  indent: "2",
};

const EXAMPLES: Record<Engine, string[]> = {
  jsonpath: ["$..name", "$.items[*].price", "$.items[?@.price > 10]", "$.items[0:2]", "$..[?@.active == true].id"],
  jq: [".items[].name", "[.items[] | select(.price > 10)]", "map_values(length?)", ".items | sort_by(.price) | reverse | .[0]", "[.items[].price] | add"],
};

export default function JsonQueryTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const query = state[state.engine];
  const setQuery = (value: string) => update({ [state.engine]: value } as Partial<State>);

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    return runQuery(state.input, {
      engine: state.engine,
      query,
      output: state.output,
      raw: state.raw,
      indent: state.indent === "minify" ? null : state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
    });
  }, [state.input, state.engine, query, state.output, state.raw, state.indent]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Query language" className="segmented">
          {(["jsonpath", "jq"] as const).map((engine) => (
            <button
              key={engine}
              type="button"
              className="btn-small"
              aria-pressed={state.engine === engine}
              onClick={() => update({ engine })}
            >
              {engine === "jsonpath" ? "JSONPath" : "jq"}
            </button>
          ))}
        </div>
        <div className="pane" style={{ flex: 1, minWidth: "16rem" }}>
          <div className="pane-header">
            <label htmlFor="json-query-input">{state.engine === "jsonpath" ? "JSONPath" : "jq filter"}</label>
          </div>
          <input
            id="json-query-input"
            className="pane-text"
            type="text"
            value={query}
            placeholder={EXAMPLES[state.engine][0]}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="toolbar">
        {state.engine === "jsonpath" ? (
          <label>
            Show{" "}
            <select value={state.output} onChange={(e) => update({ output: e.target.value as State["output"] })}>
              <option value="values">Values</option>
              <option value="paths">Paths</option>
              <option value="both">Paths + values</option>
            </select>
          </label>
        ) : (
          <label>
            <input type="checkbox" checked={state.raw} onChange={(e) => update({ raw: e.target.checked })} /> Raw strings
            (-r)
          </label>
        )}
        <label>
          Output{" "}
          <select value={state.indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
            <option value="minify">Compact</option>
          </select>
        </label>
        <label>
          Examples{" "}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setQuery(e.target.value);
            }}
          >
            <option value="">Pick one…</option>
            {EXAMPLES[state.engine].map((example) => (
              <option key={example} value={example}>
                {example}
              </option>
            ))}
          </select>
        </label>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane
          label="JSON"
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={'{"items": [{"name": "a", "price": 5}, {"name": "b", "price": 12}]}'}
        />
        <TextPane
          label={result?.ok ? `Result (${result.count} ${result.count === 1 ? "match" : "matches"})` : "Result"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title="Query failed" />
      <p className="muted small" style={{ marginTop: "1rem" }}>
        {state.engine === "jsonpath"
          ? "JSONPath follows RFC 9535: names, indexes, slices, wildcards, .., filters with && || !, and length / count / match / search / value."
          : "jq subset: paths, pipes, select/map/sort_by/group_by, object and array construction, string interpolation, if/elif/else. Variables, reduce, def and update operators (|=) are not supported."}
      </p>
    </div>
  );
}
