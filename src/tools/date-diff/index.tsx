import { useMemo } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import { describeInstant } from "../unix-timestamp/logic";
import { listTimeZones, localTimeZone } from "../unix-timestamp/zones";
import { addIsoDuration, diffDates } from "./logic";

export const TOOL_ID = "date-diff";

interface State {
  timeZone: string;
  start: string;
  end: string;
  baseDate: string;
  duration: string;
  op: "add" | "subtract";
}

const DEFAULTS: State = {
  timeZone: localTimeZone(),
  start: "2026-01-01 00:00:00",
  end: "2026-11-27 09:00:00",
  baseDate: "2026-11-27 09:00:00",
  duration: "P1M2DT3H",
  op: "add",
};

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, ""));

export default function DateDiff() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));

  const zones = useMemo(() => {
    const list = listTimeZones();
    return list.includes(state.timeZone) ? list : [state.timeZone, ...list];
  }, [state.timeZone]);

  const setNowFor = (field: "start" | "end" | "baseDate") => {
    const view = describeInstant(Date.now(), state.timeZone);
    update({ [field]: view.zonedText.slice(0, 19) });
  };

  const diffRes = useMemo(() => {
    if (!state.start.trim() && !state.end.trim()) return null;
    return diffDates(state.start, state.end, state.timeZone);
  }, [state.start, state.end, state.timeZone]);

  const arithRes = useMemo(() => {
    if (!state.baseDate.trim() || !state.duration.trim()) return null;
    return addIsoDuration(state.baseDate, state.duration, state.timeZone, state.op === "subtract");
  }, [state.baseDate, state.duration, state.timeZone, state.op]);

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
        <ShareButton toolId={TOOL_ID} state={state} />
      </div>

      <h2 className="section-title">Date difference</h2>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="pane" style={{ flex: 1, minWidth: "15rem" }}>
          <div className="pane-header">
            <label htmlFor="dd-start">Start date</label>
            <button type="button" className="btn-small" onClick={() => setNowFor("start")}>
              Now
            </button>
          </div>
          <input
            id="dd-start"
            className="pane-text"
            type="text"
            value={state.start}
            placeholder="2026-01-01 00:00:00"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ start: e.target.value })}
          />
        </div>
        <div className="pane" style={{ flex: 1, minWidth: "15rem" }}>
          <div className="pane-header">
            <label htmlFor="dd-end">End date</label>
            <button type="button" className="btn-small" onClick={() => setNowFor("end")}>
              Now
            </button>
          </div>
          <input
            id="dd-end"
            className="pane-text"
            type="text"
            value={state.end}
            placeholder="2026-11-27 09:00:00"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ end: e.target.value })}
          />
        </div>
        <button type="button" className="btn-small" onClick={() => update({ start: state.end, end: state.start })}>
          Swap
        </button>
      </div>

      {diffRes && !diffRes.ok && <ErrorDisplay error={diffRes.error} title="Cannot calculate difference" />}
      {diffRes?.ok && (
        <>
          <p className="status">
            <strong>{diffRes.diff.humanReadable}</strong>
            {diffRes.diff.direction === "backward" ? " (end is before start)" : ""}
          </p>
          <dl className="results">
            <div className="result-row">
              <dt>ISO 8601 duration</dt>
              <dd>
                <code>{diffRes.diff.isoDuration}</code>
                <CopyButton text={diffRes.diff.isoDuration} />
              </dd>
            </div>
            <div className="result-row">
              <dt>Total days / weeks</dt>
              <dd>
                <code>{fmtNum(diffRes.diff.totalDays)} days</code>
                <span className="muted small">({fmtNum(diffRes.diff.totalWeeks)} weeks)</span>
              </dd>
            </div>
            <div className="result-row">
              <dt>Total hours / minutes / seconds</dt>
              <dd>
                <code>{fmtNum(diffRes.diff.totalHours)} h</code>
                <span className="muted small">
                  · {fmtNum(diffRes.diff.totalMinutes)} m · {fmtNum(diffRes.diff.totalSeconds)} s
                </span>
              </dd>
            </div>
            <div className="result-row">
              <dt>Weekdays / weekends</dt>
              <dd>
                <code>
                  {diffRes.diff.weekdays} weekdays · {diffRes.diff.weekendDays} weekend days
                </code>
              </dd>
            </div>
          </dl>
        </>
      )}

      <h2 className="section-title">Add / subtract ISO 8601 duration</h2>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="pane" style={{ flex: 1, minWidth: "15rem" }}>
          <div className="pane-header">
            <label htmlFor="dd-base">Base date</label>
            <button type="button" className="btn-small" onClick={() => setNowFor("baseDate")}>
              Now
            </button>
          </div>
          <input
            id="dd-base"
            className="pane-text"
            type="text"
            value={state.baseDate}
            placeholder="2026-11-27 09:00:00"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ baseDate: e.target.value })}
          />
        </div>
        <label>
          Operation{" "}
          <select value={state.op} onChange={(e) => update({ op: e.target.value as "add" | "subtract" })}>
            <option value="add">Add (+)</option>
            <option value="subtract">Subtract (−)</option>
          </select>
        </label>
        <div className="pane" style={{ flex: 1, minWidth: "12rem" }}>
          <div className="pane-header">
            <label htmlFor="dd-dur">ISO 8601 duration</label>
          </div>
          <input
            id="dd-dur"
            className="pane-text"
            type="text"
            value={state.duration}
            placeholder="P1Y2M3DT4H5M6S"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => update({ duration: e.target.value })}
          />
        </div>
      </div>

      {arithRes && !arithRes.ok && <ErrorDisplay error={arithRes.error} title="Cannot apply duration" />}
      {arithRes?.ok && (
        <dl className="results">
          <div className="result-row">
            <dt>Result ({state.timeZone})</dt>
            <dd>
              <code>{arithRes.view.zonedText.slice(0, 19)}</code>
              <span className="muted small">
                {arithRes.view.weekday}, {arithRes.view.zoneName}
              </span>
              <CopyButton text={arithRes.view.zonedText.slice(0, 19)} />
            </dd>
          </div>
          <div className="result-row">
            <dt>Result (ISO 8601)</dt>
            <dd>
              <code>{arithRes.view.zonedIso}</code>
              <CopyButton text={arithRes.view.zonedIso} />
            </dd>
          </div>
          <div className="result-row">
            <dt>UTC (ISO 8601)</dt>
            <dd>
              <code>{arithRes.view.utcIso}</code>
              <CopyButton text={arithRes.view.utcIso} />
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
