import { useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { describeInstant } from "../unix-timestamp/logic";
import { listTimeZones, localTimeZone } from "../unix-timestamp/zones";
import { COMMON_TIMEZONES, convertTimeZone } from "./logic";

export const TOOL_ID = "timezone-converter";

interface State {
  date: string;
  fromZone: string;
  toZones: string[];
}

function defaultTargets(fromZone: string): string[] {
  const candidates = ["UTC", "Asia/Jakarta", "Europe/London", "America/New_York", "Asia/Tokyo"];
  return candidates.filter((z) => z !== fromZone).slice(0, 4);
}

const initialFrom = localTimeZone();
const DEFAULTS: State = {
  date: "",
  fromZone: initialFrom,
  toZones: defaultTargets(initialFrom),
};

function dayShiftLabel(shift: number): string | null {
  if (shift === 0) return null;
  if (shift > 0) return `+${shift} day${shift > 1 ? "s" : ""}`;
  return `${shift} day${shift < -1 ? "s" : ""}`;
}

export default function TimezoneConverter() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ date: text.trim() }));

  const [addZone, setAddZone] = useState("Asia/Singapore");

  const zones = useMemo(() => {
    const list = listTimeZones();
    const extra = [state.fromZone, ...state.toZones].filter((z) => !list.includes(z));
    return [...extra, ...list];
  }, [state.fromZone, state.toZones]);

  const setNow = () => {
    const view = describeInstant(Date.now(), state.fromZone);
    update({ date: view.zonedText.slice(0, 19) });
  };

  const addTarget = (zone: string) => {
    if (!zone || state.toZones.includes(zone)) return;
    update({ toZones: [...state.toZones, zone] });
  };

  const removeTarget = (zone: string) => {
    update({ toZones: state.toZones.filter((z) => z !== zone) });
  };

  const swapWithTarget = (targetZone: string) => {
    const nextTargets = state.toZones.map((z) => (z === targetZone ? state.fromZone : z));
    update({ fromZone: targetZone, toZones: [...new Set(nextTargets)] });
  };

  const result = state.date.trim() === "" ? null : convertTimeZone(state.date, state.fromZone, state.toZones);

  return (
    <div>
      <div className="toolbar">
        <label>
          Source time zone{" "}
          <select value={state.fromZone} onChange={(e) => update({ fromZone: e.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-small" onClick={setNow}>
          Use current time
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button
          type="button"
          className="btn-small"
          onClick={() => update({ date: "" })}
          disabled={!state.date}
        >
          Clear
        </button>
      </div>

      <div className="pane">
        <div className="pane-header">
          <label htmlFor="tz-date-input">Date and time (in {state.fromZone} unless it ends with Z or ±hh:mm)</label>
        </div>
        <input
          id="tz-date-input"
          className="pane-text"
          type="text"
          value={state.date}
          placeholder="2026-11-27 09:00:00 or 2026-11-27T09:00:00+07:00"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => update({ date: e.target.value })}
        />
      </div>

      <h2 className="section-title">Target time zones</h2>
      <div className="toolbar">
        <label>
          Add zone{" "}
          <select value={addZone} onChange={(e) => setAddZone(e.target.value)}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-small" onClick={() => addTarget(addZone)} disabled={state.toZones.includes(addZone)}>
          Add
        </button>
        {COMMON_TIMEZONES.filter((z) => !state.toZones.includes(z) && z !== state.fromZone)
          .slice(0, 4)
          .map((z) => (
            <button key={z} type="button" className="btn-small" onClick={() => addTarget(z)}>
              + {z}
            </button>
          ))}
      </div>

      {result && !result.ok && <ErrorDisplay error={result.error} title="Cannot convert" />}

      {result?.ok && (
        <>
          <p className="status">
            Source: <code>{result.source.view.zonedText.slice(0, 19)}</code> ({result.source.timeZone}, {result.source.view.offset},{" "}
            {result.source.view.weekday})
          </p>
          <dl className="results">
            {result.targets.map((t) => {
              const shift = dayShiftLabel(t.dayShift);
              return (
                <div key={t.timeZone} className="result-row">
                  <dt>
                    {t.timeZone}
                    <div className="muted small">
                      {t.view.offset} ({t.diffLabel} vs source)
                    </div>
                  </dt>
                  <dd>
                    <code>{t.view.zonedText.slice(0, 19)}</code>
                    <span className="muted small">
                      {t.view.weekday}, {t.view.zoneName}
                      {shift ? ` · ${shift}` : ""}
                    </span>
                    <CopyButton text={t.view.zonedIso} label="ISO" />
                    <CopyButton text={t.view.zonedText.slice(0, 19)} />
                    <button type="button" className="btn-small" onClick={() => swapWithTarget(t.timeZone)} title="Make this the source zone">
                      Swap
                    </button>
                    <button
                      type="button"
                      className="btn-small"
                      onClick={() => removeTarget(t.timeZone)}
                      disabled={state.toZones.length <= 1}
                    >
                      Remove
                    </button>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}

      {!result && state.toZones.length > 0 && (
        <div className="toolbar" style={{ marginTop: "0.75rem" }}>
          <span className="muted small">Active targets:</span>
          {state.toZones.map((z) => (
            <button
              key={z}
              type="button"
              className="btn-small"
              onClick={() => removeTarget(z)}
              disabled={state.toZones.length <= 1}
              title="Remove target zone"
            >
              {z} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
