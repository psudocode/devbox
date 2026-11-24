import { useMemo } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { COMMON_BASES, MAX_BASE, MIN_BASE, formatInteger, isValidBase, parseInteger } from "./logic";

export const TOOL_ID = "number-base";

interface State {
  input: string;
  fromBase: number;
  customBase: number;
  uppercase: boolean;
  group: boolean;
}

const DEFAULTS: State = { input: "", fromBase: 10, customBase: 36, uppercase: false, group: false };

function BaseInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label htmlFor={id}>
      {label}{" "}
      <input
        id={id}
        type="number"
        min={MIN_BASE}
        max={MAX_BASE}
        step={1}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        className="base-input"
        aria-invalid={!isValidBase(value)}
      />
    </label>
  );
}

export default function NumberBase() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text.trim() }));

  const parsed = useMemo(() => (state.input.trim() === "" ? null : parseInteger(state.input, state.fromBase)), [state.input, state.fromBase]);

  const rows = useMemo(() => {
    if (!parsed?.ok) return [];
    const make = (base: number, label: string, group: number, separator: string) => ({
      base,
      label,
      text: formatInteger(parsed.value, base, {
        uppercase: state.uppercase,
        group: state.group ? group : 0,
        separator,
      }),
    });
    const list = COMMON_BASES.map((b) => make(b.base, b.label, b.group, b.separator));
    if (isValidBase(state.customBase)) list.push(make(state.customBase, `Base ${state.customBase}`, 4, " "));
    return list;
  }, [parsed, state.uppercase, state.group, state.customBase]);

  return (
    <div>
      <div className="toolbar">
        <BaseInput id="from-base" label="Input base" value={state.fromBase} onChange={(fromBase) => update({ fromBase })} />
        {[2, 8, 10, 16].map((b) => (
          <button key={b} type="button" className="btn-small" aria-pressed={state.fromBase === b} onClick={() => update({ fromBase: b })}>
            {b === 2 ? "BIN" : b === 8 ? "OCT" : b === 10 ? "DEC" : "HEX"}
          </button>
        ))}
        <BaseInput id="custom-base" label="Custom output base" value={state.customBase} onChange={(customBase) => update({ customBase })} />
        <label>
          <input type="checkbox" checked={state.uppercase} onChange={(e) => update({ uppercase: e.target.checked })} /> Uppercase
        </label>
        <label>
          <input type="checkbox" checked={state.group} onChange={(e) => update({ group: e.target.checked })} /> Group digits
        </label>
        <ShareButton toolId={TOOL_ID} state={state} />
      </div>

      <div className="pane">
        <div className="pane-header">
          <label htmlFor="number-input">Number</label>
        </div>
        <input
          id="number-input"
          className="pane-text"
          type="text"
          value={state.input}
          placeholder="e.g. 255, 0xff, 1111_1111, -42"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => update({ input: e.target.value })}
        />
      </div>

      {!isValidBase(state.fromBase) && <ErrorDisplay error={`Input base must be a whole number from ${MIN_BASE} to ${MAX_BASE}.`} />}
      {isValidBase(state.fromBase) && parsed && !parsed.ok && <ErrorDisplay error={parsed.error} title="Cannot convert" />}
      {!isValidBase(state.customBase) && (
        <ErrorDisplay error={`Custom output base must be a whole number from ${MIN_BASE} to ${MAX_BASE}.`} />
      )}

      {rows.length > 0 && (
        <dl className="results">
          {rows.map((row) => (
            <div key={row.base} className="result-row">
              <dt>{row.label}</dt>
              <dd>
                <code>{row.text}</code>
                <CopyButton text={row.text} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
