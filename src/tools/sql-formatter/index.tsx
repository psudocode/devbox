import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { DIALECTS, formatSql, type Case, type Dialect } from "./logic";

export const TOOL_ID = "sql-formatter";

type IndentChoice = "2" | "4" | "tab";

interface State {
  input: string;
  dialect: Dialect;
  indent: IndentChoice;
  keywordCase: Case;
  dataTypeCase: Case;
  functionCase: Case;
  logicalOperator: "before" | "after";
  blankLines: "0" | "1" | "2";
  denseOperators: boolean;
}

const DEFAULTS: State = {
  input: "",
  dialect: "sql",
  indent: "2",
  keywordCase: "upper",
  dataTypeCase: "preserve",
  functionCase: "preserve",
  logicalOperator: "before",
  blankLines: "1",
  denseOperators: false,
};

const CASES: { value: Case; label: string }[] = [
  { value: "upper", label: "UPPER" },
  { value: "lower", label: "lower" },
  { value: "preserve", label: "As written" },
];

function CaseSelect({ label, value, onChange }: { label: string; value: Case; onChange: (value: Case) => void }) {
  return (
    <label>
      {label}{" "}
      <select value={value} onChange={(e) => onChange(e.target.value as Case)}>
        {CASES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SqlFormatterTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    return formatSql(state.input, {
      dialect: DIALECTS.some((d) => d.id === state.dialect) ? state.dialect : "sql",
      indent: state.indent === "tab" ? "tab" : state.indent === "4" ? 4 : 2,
      keywordCase: state.keywordCase,
      dataTypeCase: state.dataTypeCase,
      functionCase: state.functionCase,
      logicalOperator: state.logicalOperator,
      linesBetweenQueries: Number(state.blankLines),
      denseOperators: state.denseOperators,
    });
  }, [state]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  return (
    <div>
      <div className="toolbar">
        <label>
          Dialect{" "}
          <select value={state.dialect} onChange={(e) => update({ dialect: e.target.value as Dialect })}>
            {DIALECTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Indent{" "}
          <select value={state.indent} onChange={(e) => update({ indent: e.target.value as IndentChoice })}>
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tab</option>
          </select>
        </label>
        <CaseSelect label="Keywords" value={state.keywordCase} onChange={(keywordCase) => update({ keywordCase })} />
        <CaseSelect label="Types" value={state.dataTypeCase} onChange={(dataTypeCase) => update({ dataTypeCase })} />
        <CaseSelect
          label="Functions"
          value={state.functionCase}
          onChange={(functionCase) => update({ functionCase })}
        />
        <label>
          AND / OR{" "}
          <select
            value={state.logicalOperator}
            onChange={(e) => update({ logicalOperator: e.target.value as State["logicalOperator"] })}
          >
            <option value="before">Start of line</option>
            <option value="after">End of line</option>
          </select>
        </label>
        <label>
          Blank lines{" "}
          <select value={state.blankLines} onChange={(e) => update({ blankLines: e.target.value as State["blankLines"] })}>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <ToolbarSwitch
          label="Dense operators"
          checked={state.denseOperators}
          onChange={(denseOperators) => update({ denseOperators })}
        />
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      {result?.ok && (
        <p className="status" aria-live="polite">
          ✓ Formatted {result.statements} statement{result.statements === 1 ? "" : "s"}
        </p>
      )}

      <div className="panes">
        <TextPane
          label="SQL"
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder="select id, name from users where active = 1 and created_at > now() - interval '7 days' order by name"
        />
        <TextPane label="Formatted SQL" value={output} actions={<SendToMenu fromToolId={TOOL_ID} value={output} />} />
      </div>
      <ErrorDisplay error={error} title="Cannot format SQL" />
    </div>
  );
}
