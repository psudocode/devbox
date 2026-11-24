import { useMemo } from "react";
import { ErrorDisplay, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { diffJson, summarize } from "./logic";

export const TOOL_ID = "json-diff";

interface State {
  left: string;
  right: string;
  ignoreArrayOrder: boolean;
}

const DEFAULTS: State = { left: "", right: "", ignoreArrayOrder: false };

const SYMBOL = { added: "+", removed: "−", changed: "~" } as const;

export default function JsonDiff() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  // Text sent from another tool lands in the left pane.
  usePipelineInput(TOOL_ID, (text) => update({ left: text }));

  const result = useMemo(
    () =>
      state.left.trim() === "" || state.right.trim() === ""
        ? null
        : diffJson(state.left, state.right, { ignoreArrayOrder: state.ignoreArrayOrder }),
    [state.left, state.right, state.ignoreArrayOrder],
  );

  const counts = result?.ok ? summarize(result.changes) : null;

  return (
    <div>
      <div className="toolbar">
        <label>
          <input
            type="checkbox"
            checked={state.ignoreArrayOrder}
            onChange={(e) => update({ ignoreArrayOrder: e.target.checked })}
          />{" "}
          Ignore array order
        </label>
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ left: state.right, right: state.left })}
          disabled={!state.left && !state.right}
        >
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ left: "", right: "" })}
          disabled={!state.left && !state.right}
        >
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane label="Left" value={state.left} onChange={(left) => update({ left })} placeholder='{"a": 1}' rows={10} />
        <TextPane label="Right" value={state.right} onChange={(right) => update({ right })} placeholder='{"a": 2}' rows={10} />
      </div>

      <p className={result && !result.ok ? "status status-bad" : "status"} aria-live="polite">
        {result === null
          ? "Paste JSON on both sides to compare."
          : !result.ok
            ? `Invalid JSON on the ${result.side}`
            : result.equal
              ? "Identical (key order and number formatting ignored)"
              : `${result.changes.length} difference${result.changes.length === 1 ? "" : "s"}: ${counts?.added} added, ${counts?.removed} removed, ${counts?.changed} changed`}
      </p>

      {result && !result.ok && <ErrorDisplay error={result.error} title={`Invalid JSON (${result.side})`} />}

      {result?.ok && !result.equal && (
        <ul className="diff-list">
          {result.changes.map((change, i) => (
            <li key={`${change.path}-${change.type}-${i}`} className={`diff-item diff-${change.type}`}>
              <span className="diff-symbol" aria-label={change.type} title={change.type}>
                {SYMBOL[change.type]}
              </span>
              <code className="diff-path">{change.path}</code>
              <span className="diff-values">
                {change.left !== undefined && <code className="diff-left">{change.left}</code>}
                {change.type === "changed" && " → "}
                {change.right !== undefined && <code className="diff-right">{change.right}</code>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
