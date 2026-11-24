import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton, ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { createRegexExecutor, type RegexExecutor } from "./executor";
import { FLAG_INFO, MAX_MATCHES, highlightSegments, type RegexResult } from "./logic";

export const TOOL_ID = "regex-tester";

interface State {
  pattern: string;
  flags: string;
  text: string;
  replacement: string;
  showReplace: boolean;
}

const DEFAULTS: State = {
  pattern: "",
  flags: "g",
  text: "",
  replacement: "",
  showReplace: false,
};

function toggleFlag(flags: string, flag: string): string {
  const next = flags.includes(flag) ? flags.split(flag).join("") : flags + flag;
  const order = FLAG_INFO.map((f) => f.flag).join("");
  return [...next].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("");
}

export default function RegexTester() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ text }));

  const executorRef = useRef<RegexExecutor | null>(null);
  const [result, setResult] = useState<RegexResult | null>(null);

  useEffect(() => {
    const executor = createRegexExecutor();
    executorRef.current = executor;
    return () => {
      executor.dispose();
      executorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state.pattern === "") {
      setResult(null);
      return;
    }
    const executor = executorRef.current;
    if (!executor) return;

    let cancelled = false;
    void executor
      .run({
        pattern: state.pattern,
        flags: state.flags,
        text: state.text,
        replacement: state.showReplace ? state.replacement : null,
      })
      .then((res) => {
        if (!cancelled && res !== null) setResult(res);
      });

    return () => {
      cancelled = true;
    };
  }, [state.pattern, state.flags, state.text, state.replacement, state.showReplace]);

  const outcome = result?.ok ? result.outcome : null;
  const segments = useMemo(
    () => (outcome ? highlightSegments(state.text, outcome.matches) : []),
    [outcome, state.text],
  );

  return (
    <div>
      <div className="toolbar">
        <div className="pane" style={{ flex: 1, minWidth: "16rem" }}>
          <div className="pane-header">
            <label htmlFor="regex-pattern">Pattern</label>
          </div>
          <input
            id="regex-pattern"
            className="pane-text"
            type="text"
            value={state.pattern}
            placeholder="e.g. (?<year>\d{4})-(\d{2})"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ pattern: e.target.value })}
          />
        </div>

        <div className="segmented" role="group" aria-label="Regex flags">
          {FLAG_INFO.map((f) => (
            <button
              key={f.flag}
              type="button"
              className="btn-small"
              aria-pressed={state.flags.includes(f.flag)}
              title={`${f.name}: ${f.hint}`}
              onClick={() => update({ flags: toggleFlag(state.flags, f.flag) })}
            >
              {f.flag}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn-small"
          aria-pressed={state.showReplace}
          onClick={() => update({ showReplace: !state.showReplace })}
        >
          Replace
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ pattern: "", text: "", replacement: "" })}
          disabled={!state.pattern && !state.text && !state.replacement}
        >
          Clear
        </button>
      </div>

      {result && !result.ok && <ErrorDisplay error={result.error} title="Invalid regular expression" />}

      <TextPane
        label="Test string"
        value={state.text}
        onChange={(text) => update({ text })}
        placeholder="Paste or type text to test against the pattern..."
        rows={7}
      />

      {outcome && (
        <p className="status" style={{ marginTop: "0.75rem" }}>
          {outcome.matches.length} {outcome.matches.length === 1 ? "match" : "matches"}
          {outcome.truncated ? ` (showing first ${MAX_MATCHES})` : ""}
        </p>
      )}

      {outcome && state.text !== "" && (
        <div className="pane" style={{ marginTop: "0.75rem" }}>
          <div className="pane-header">
            <span>Highlighted matches</span>
          </div>
          <pre className="regex-highlight" aria-label="Highlighted matches">
            {segments.map((seg, i) =>
              seg.match === null ? (
                <span key={i}>{seg.text}</span>
              ) : (
                <mark
                  key={i}
                  className={seg.match % 2 === 0 ? "regex-match" : "regex-match regex-match-alt"}
                  title={`Match #${seg.match + 1}`}
                >
                  {seg.text}
                </mark>
              ),
            )}
          </pre>
        </div>
      )}

      {state.showReplace && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="pane">
            <div className="pane-header">
              <label htmlFor="regex-replacement">Replacement</label>
            </div>
            <input
              id="regex-replacement"
              className="pane-text"
              type="text"
              value={state.replacement}
              placeholder="e.g. $2/$1 or $<name>"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => update({ replacement: e.target.value })}
            />
          </div>
          <TextPane
            label="Replaced"
            value={outcome?.replaced ?? ""}
            rows={5}
            actions={<SendToMenu fromToolId={TOOL_ID} value={outcome?.replaced ?? ""} />}
          />
        </div>
      )}

      {outcome && outcome.matches.length > 0 && (
        <>
          <h2 className="section-title">Matches</h2>
          <dl className="results">
            {outcome.matches.map((m, idx) => (
              <div key={`${m.index}-${idx}`} className="result-row">
                <dt>
                  #{idx + 1} <span className="muted small">[{m.index}..{m.end})</span>
                </dt>
                <dd>
                  <code>{m.text === "" ? "(empty match)" : m.text}</code>
                  <CopyButton text={m.text} />
                  {m.groups.length > 0 && (
                    <span className="regex-groups">
                      {m.groups.map((g) => (
                        <span key={g.number} className="regex-group-chip">
                          {g.name ? `$${g.number} (${g.name})` : `$${g.number}`}:{" "}
                          <code>{g.text === undefined ? "undefined" : g.text === "" ? '""' : g.text}</code>
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
