import { useEffect, useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { formatRelative } from "../../lib/time";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import {
  UNIT_LABEL,
  dateToTimestamp,
  describeInstant,
  timestampToDate,
  type InstantView,
  type Unit,
} from "./logic";
import { listTimeZones, localTimeZone } from "./zones";

export const TOOL_ID = "unix-timestamp";

interface State {
  timestamp: string;
  unit: Unit;
  timeZone: string;
  date: string;
}

const DEFAULTS: State = { timestamp: "", unit: "auto", timeZone: localTimeZone(), date: "" };

function Rows({ rows }: { rows: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="results">
      {rows.map((row) => (
        <div key={row.label} className="result-row">
          <dt>{row.label}</dt>
          <dd>
            <code>{row.value}</code>
            {row.note && <span className="muted small">{row.note}</span>}
            <CopyButton text={row.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function viewRows(view: InstantView, timeZone: string, nowMs: number) {
  return [
    { label: "UTC (ISO 8601)", value: view.utcIso },
    { label: `${timeZone} (ISO 8601)`, value: view.zonedIso, note: `${view.weekday}, ${view.zoneName}` },
    { label: `${timeZone} (readable)`, value: view.zonedText },
    { label: "Unix seconds", value: String(view.seconds) },
    { label: "Unix milliseconds", value: String(Math.floor(view.ms)) },
    { label: "Relative", value: formatRelative(view.ms / 1000, nowMs) },
  ];
}

export default function UnixTimestamp() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ timestamp: text.trim() }));

  // Live clock, also used for the "relative" rows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const zones = useMemo(() => {
    const list = listTimeZones();
    return list.includes(state.timeZone) ? list : [state.timeZone, ...list];
  }, [state.timeZone]);

  const fromTimestamp = state.timestamp.trim() === "" ? null : timestampToDate(state.timestamp, state.unit, state.timeZone);
  const fromDate = state.date.trim() === "" ? null : dateToTimestamp(state.date, state.timeZone);

  const setNowValues = () => {
    const ms = Date.now();
    const view = describeInstant(ms, state.timeZone);
    update({ timestamp: String(Math.floor(ms / 1000)), unit: "s", date: view.zonedText.slice(0, 19) });
  };

  return (
    <div>
      <p className="status" aria-live="off">
        Now: <code>{Math.floor(now / 1000)}</code> s · <code>{now}</code> ms
      </p>

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
        <button type="button" className="btn-small" onClick={setNowValues}>
          Use current time
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ timestamp: "", date: "" })}
          disabled={!state.timestamp && !state.date}
        >
          Clear
        </button>
      </div>

      <h2 className="section-title">Timestamp → date</h2>
      <div className="toolbar">
        <div className="pane" style={{ flex: 1, minWidth: "14rem" }}>
          <div className="pane-header">
            <label htmlFor="timestamp-input">Unix timestamp</label>
          </div>
          <input
            id="timestamp-input"
            className="pane-text"
            type="text"
            inputMode="decimal"
            value={state.timestamp}
            placeholder="1700000000 or 1700000000000"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ timestamp: e.target.value })}
          />
        </div>
        <label>
          Unit{" "}
          <select value={state.unit} onChange={(e) => update({ unit: e.target.value as Unit })}>
            <option value="auto">Auto-detect</option>
            {(Object.keys(UNIT_LABEL) as (keyof typeof UNIT_LABEL)[]).map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fromTimestamp && !fromTimestamp.ok && <ErrorDisplay error={fromTimestamp.error} title="Cannot convert" />}
      {fromTimestamp?.ok && (
        <>
          <p className="status">
            Read as {UNIT_LABEL[fromTimestamp.unit]}
            {fromTimestamp.detected ? " (auto-detected)" : ""}
          </p>
          <Rows rows={viewRows(fromTimestamp.view, state.timeZone, now)} />
        </>
      )}

      <h2 className="section-title">Date → timestamp</h2>
      <div className="pane">
        <div className="pane-header">
          <label htmlFor="date-input">Date and time (in {state.timeZone} unless it ends with Z or ±hh:mm)</label>
        </div>
        <input
          id="date-input"
          className="pane-text"
          type="text"
          value={state.date}
          placeholder="2026-11-25 01:30:00 or 2026-11-25T01:30:00+07:00"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => update({ date: e.target.value })}
        />
      </div>
      {fromDate && !fromDate.ok && <ErrorDisplay error={fromDate.error} title="Cannot parse date" />}
      {fromDate?.ok && <Rows rows={viewRows(fromDate.view, state.timeZone, now)} />}
    </div>
  );
}
