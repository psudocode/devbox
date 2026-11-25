import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { generateTypes, type Target } from "./logic";

export const TOOL_ID = "json-types";

interface State {
  input: string;
  target: Target;
  rootName: string;
  tsStyle: "interface" | "type";
  tsExport: boolean;
  tsReadonly: boolean;
  goOmitempty: boolean;
  zodInfer: boolean;
  zodExport: boolean;
}

const DEFAULTS: State = {
  input: "",
  target: "typescript",
  rootName: "Root",
  tsStyle: "interface",
  tsExport: true,
  tsReadonly: false,
  goOmitempty: true,
  zodInfer: true,
  zodExport: true,
};

const TARGETS: { id: Target; label: string }[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "go", label: "Go struct" },
  { id: "zod", label: "Zod" },
];

const OUTPUT_LABEL: Record<Target, string> = { typescript: "TypeScript", go: "Go", zod: "Zod schema" };

export default function JsonTypesTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => {
    if (state.input.trim() === "") return null;
    return generateTypes(state.input, {
      target: state.target,
      rootName: state.rootName,
      typescript: { style: state.tsStyle, exportTypes: state.tsExport, readonly: state.tsReadonly },
      go: { omitempty: state.goOmitempty },
      zod: { inferTypes: state.zodInfer, exportSchemas: state.zodExport },
    });
  }, [
    state.input,
    state.target,
    state.rootName,
    state.tsStyle,
    state.tsExport,
    state.tsReadonly,
    state.goOmitempty,
    state.zodInfer,
    state.zodExport,
  ]);

  const output = result?.ok ? result.output : "";
  const error = result && !result.ok ? result.error : null;

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Output language" className="segmented">
          {TARGETS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="btn-small"
              aria-pressed={state.target === id}
              onClick={() => update({ target: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Root name{" "}
          <input
            type="text"
            value={state.rootName}
            size={10}
            spellCheck={false}
            onChange={(e) => update({ rootName: e.target.value })}
          />
        </label>
        {state.target === "typescript" && (
          <>
            <label>
              Style{" "}
              <select value={state.tsStyle} onChange={(e) => update({ tsStyle: e.target.value as State["tsStyle"] })}>
                <option value="interface">interface</option>
                <option value="type">type</option>
              </select>
            </label>
            <ToolbarSwitch label="export" checked={state.tsExport} onChange={(tsExport) => update({ tsExport })} />
            <ToolbarSwitch
              label="readonly"
              checked={state.tsReadonly}
              onChange={(tsReadonly) => update({ tsReadonly })}
            />
          </>
        )}
        {state.target === "go" && (
          <ToolbarSwitch
            label="omitempty on optional"
            checked={state.goOmitempty}
            onChange={(goOmitempty) => update({ goOmitempty })}
          />
        )}
        {state.target === "zod" && (
          <>
            <ToolbarSwitch label="export" checked={state.zodExport} onChange={(zodExport) => update({ zodExport })} />
            <ToolbarSwitch
              label="z.infer types"
              checked={state.zodInfer}
              onChange={(zodInfer) => update({ zodInfer })}
            />
          </>
        )}
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane
          label="JSON sample"
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={'{"id": 1, "name": "Ann", "tags": ["a"], "address": {"city": "Jakarta"}}'}
        />
        <TextPane
          label={OUTPUT_LABEL[state.target]}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title="Cannot generate types" />
    </div>
  );
}
