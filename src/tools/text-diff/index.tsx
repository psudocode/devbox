import { useMemo, type ReactNode } from "react";
import { CopyButton, ErrorDisplay, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { collapseContext, diffText, toUnifiedDiff, type DiffLine, type Row } from "./logic";

export const TOOL_ID = "text-diff";

type View = "split" | "unified";
type Inline = "word" | "char" | "none";
type Context = "3" | "5" | "10" | "all";

interface State {
  original: string;
  modified: string;
  view: View;
  inline: Inline;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  context: Context;
}

const DEFAULTS: State = {
  original: "",
  modified: "",
  view: "split",
  inline: "word",
  ignoreWhitespace: false,
  ignoreCase: false,
  context: "5",
};

function renderLine(line: DiffLine): ReactNode {
  if (line.segments) {
    return line.segments.map((s, i) => (s.changed ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>));
  }
  return line.text === "" ? " " : line.text;
}

function Cells({ row }: { row: Row }) {
  const left = row.kind === "add" ? null : row.left;
  const right = row.kind === "remove" ? null : row.right;
  const leftClass = left ? (row.kind === "equal" ? "" : "td-del") : "td-empty";
  const rightClass = right ? (row.kind === "equal" ? "" : "td-add") : "td-empty";
  return (
    <>
      <td className={`td-no ${leftClass}`}>{left?.no}</td>
      <td className={leftClass}>{left && renderLine(left)}</td>
      <td className={`td-no td-split ${rightClass}`}>{right?.no}</td>
      <td className={rightClass}>{right && renderLine(right)}</td>
    </>
  );
}

export default function TextDiffTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  // Pipeline text goes to the modified side; the original is whatever you pasted first.
  usePipelineInput(TOOL_ID, (text) => update({ modified: text }));

  const empty = state.original === "" && state.modified === "";
  const result = useMemo(
    () =>
      empty
        ? null
        : diffText(state.original, state.modified, {
            ignoreWhitespace: state.ignoreWhitespace,
            ignoreCase: state.ignoreCase,
            inline: state.inline,
          }),
    [empty, state.original, state.modified, state.ignoreWhitespace, state.ignoreCase, state.inline],
  );

  const context = state.context === "all" ? Infinity : Number(state.context);
  const rows = result?.ok ? result.rows : null;
  const items = useMemo(() => (rows ? collapseContext(rows, context) : []), [rows, context]);
  const unified = useMemo(
    () => (rows ? toUnifiedDiff(rows, { context: Number.isFinite(context) ? context : rows.length }) : ""),
    [rows, context],
  );

  const error = result && !result.ok ? result.error : null;
  const stats = result?.ok ? result.stats : null;

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="View" className="segmented">
          {(["split", "unified"] as const).map((view) => (
            <button
              key={view}
              type="button"
              className="btn-small"
              aria-pressed={state.view === view}
              onClick={() => update({ view })}
            >
              {view === "split" ? "Side by side" : "Unified"}
            </button>
          ))}
        </div>
        <label>
          Highlight{" "}
          <select value={state.inline} onChange={(e) => update({ inline: e.target.value as Inline })}>
            <option value="word">Words</option>
            <option value="char">Characters</option>
            <option value="none">Lines only</option>
          </select>
        </label>
        <label>
          Context{" "}
          <select value={state.context} onChange={(e) => update({ context: e.target.value as Context })}>
            <option value="3">3 lines</option>
            <option value="5">5 lines</option>
            <option value="10">10 lines</option>
            <option value="all">Whole text</option>
          </select>
        </label>
        <ToolbarSwitch
          label="Ignore whitespace"
          checked={state.ignoreWhitespace}
          onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}
        />
        <ToolbarSwitch label="Ignore case" checked={state.ignoreCase} onChange={(ignoreCase) => update({ ignoreCase })} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ original: state.modified, modified: state.original })}
          disabled={empty}
        >
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ original: "", modified: "" })}
          disabled={empty}
        >
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane
          label="Original"
          value={state.original}
          rows={10}
          onChange={(original) => update({ original })}
          placeholder="Paste the original text"
        />
        <TextPane
          label="Modified"
          value={state.modified}
          rows={10}
          onChange={(modified) => update({ modified })}
          placeholder="Paste the modified text"
        />
      </div>

      {stats && (
        <p className="status" aria-live="polite">
          {stats.identical
            ? "✓ The texts are identical."
            : stats.added + stats.removed === 0
              ? "✓ No differences apart from whitespace or case."
              : `+${stats.added} added · −${stats.removed} removed · ${stats.changed} changed · ${stats.unchanged} unchanged`}
        </p>
      )}
      <ErrorDisplay error={error} title="Cannot compare" />

      {rows && stats && stats.added + stats.removed > 0 && (
        <>
          <div className="pane-actions" style={{ marginTop: "0.75rem" }}>
            <CopyButton text={unified} label="Copy unified diff" />
          </div>
          <div className="text-diff-wrap">
            {state.view === "split" ? (
              <table className="text-diff" aria-label="Differences">
                <colgroup>
                  <col style={{ width: "3.25rem" }} />
                  <col />
                  <col style={{ width: "3.25rem" }} />
                  <col />
                </colgroup>
                <tbody>
                  {items.map((item, i) =>
                    item.kind === "skip" ? (
                      <tr key={i} className="td-skip">
                        <td colSpan={4}>
                          ⋯ {item.count} unchanged line{item.count === 1 ? "" : "s"} ⋯
                        </td>
                      </tr>
                    ) : (
                      <tr key={i}>
                        <Cells row={item} />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ) : (
              <pre className="text-diff-unified" aria-label="Unified diff">
                {unified.split("\n").map((line, i) =>
                  line === "" ? null : (
                    <span
                      key={i}
                      className={
                        line.startsWith("@@") ? "ud-hunk" : line.startsWith("+") && !line.startsWith("+++") ? "ud-add" : line.startsWith("-") && !line.startsWith("---") ? "ud-del" : undefined
                      }
                    >
                      {line}
                    </span>
                  ),
                )}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
