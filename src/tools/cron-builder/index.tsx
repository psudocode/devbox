import { useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { listTimeZones, localTimeZone } from "../unix-timestamp/zones";
import { CRON_FIELD_SPECS, CRON_PRESETS, explainCron, nextCronRuns, parseCron } from "./logic";

export const TOOL_ID = "cron-builder";

interface State {
  expression: string;
  timeZone: string;
  count: number;
}

const DEFAULTS: State = {
  expression: "*/15 * * * *",
  timeZone: localTimeZone(),
  count: 10,
};

export default function CronBuilder() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ expression: text.trim() }));

  const [baseMs, setBaseMs] = useState(() => Date.now());

  const zones = useMemo(() => {
    const list = listTimeZones();
    return list.includes(state.timeZone) ? list : [state.timeZone, ...list];
  }, [state.timeZone]);

  const parsed = useMemo(() => parseCron(state.expression), [state.expression]);
  const explained = useMemo(() => explainCron(state.expression), [state.expression]);
  const nextRuns = useMemo(
    () => (parsed.ok ? nextCronRuns(state.expression, state.count, baseMs, state.timeZone) : null),
    [parsed.ok, state.expression, state.count, baseMs, state.timeZone],
  );

  const rawTokens = parsed.ok ? parsed.cron.normalized.split(" ") : state.expression.trim().split(/\s+/);
  const updateField = (index: number, value: string) => {
    const next = [0, 1, 2, 3, 4].map((i) => (i === index ? value.trim() || "*" : rawTokens[i] || "*"));
    update({ expression: next.join(" ") });
  };

  return (
    <div>
      <div className="toolbar">
        <label>
          Time zone{" "}
          <select value={state.timeZone} onChange={(e) => update({ timeZone: e.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next runs{" "}
          <select value={state.count} onChange={(e) => update({ count: Number(e.target.value) })}>
            {[5, 10, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-small" onClick={() => setBaseMs(Date.now())}>
          Refresh from now
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
      </div>

      <div className="toolbar">
        {CRON_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="btn-small" onClick={() => update({ expression: preset.expression })}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="pane">
        <div className="pane-header">
          <label htmlFor="cron-expr-input">Cron expression (minute hour day-of-month month day-of-week, or @daily/@hourly)</label>
          {parsed.ok && <CopyButton text={parsed.cron.normalized} label="Copy" />}
        </div>
        <input
          id="cron-expr-input"
          className="pane-text"
          type="text"
          value={state.expression}
          placeholder="*/15 * * * *"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => update({ expression: e.target.value })}
        />
      </div>

      <h2 className="section-title">Field builder</h2>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        {CRON_FIELD_SPECS.map((spec, idx) => (
          <label key={spec.name} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "8rem", flex: 1 }}>
            <span className="small muted">
              {spec.name} ({spec.min}–{spec.max})
            </span>
            <input
              className="pane-text"
              type="text"
              value={rawTokens[idx] ?? "*"}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => updateField(idx, e.target.value)}
            />
          </label>
        ))}
      </div>

      {!explained.ok && <ErrorDisplay error={explained.error} title="Invalid cron expression" />}

      {explained.ok && (
        <>
          <p className="status">
            <strong>{explained.summary}</strong>
          </p>
          <dl className="results">
            {explained.fieldDescriptions.map((f) => (
              <div key={f.name} className="result-row">
                <dt>{f.name}</dt>
                <dd>
                  <code>{f.raw}</code>
                  <span className="muted small">{f.description}</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h2 className="section-title">Next {state.count} runs ({state.timeZone})</h2>
      {nextRuns && !nextRuns.ok && <ErrorDisplay error={nextRuns.error} title="Cannot compute runs" />}
      {nextRuns?.ok && (
        <dl className="results">
          {nextRuns.runs.map((run, idx) => (
            <div key={run.utcIso} className="result-row">
              <dt>#{idx + 1}</dt>
              <dd>
                <code>{run.zonedText.slice(0, 19)}</code>
                <span className="muted small">
                  {run.weekday}, {run.zoneName} · UTC {run.utcIso}
                </span>
                <CopyButton text={run.zonedIso} label="ISO" />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
