import { useMemo, useState } from "react";
import { ErrorDisplay, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import {
  DEFAULT_OPTIONS,
  MAX_COUNT,
  MAX_LENGTH,
  MIN_LENGTH,
  clampCount,
  clampLength,
  estimateStrength,
  generatePasswords,
  generatedEntropyBits,
  validateOptions,
  type PasswordOptions,
} from "./logic";

export const TOOL_ID = "password-generator";

interface State extends PasswordOptions {
  count: number;
}

// Only the options are persisted/shared. Generated passwords and the text you check are never stored or linked.
const DEFAULTS: State = { ...DEFAULT_OPTIONS, count: 5 };

const SCORE_COLORS = ["#d13438", "#e97548", "#c19c00", "#498205", "#107c10"];

export default function PasswordGenerator() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  const [generation, setGeneration] = useState(0);
  const [checkText, setCheckText] = useState("");

  const error = validateOptions(state);
  const passwords = useMemo(
    () => (error ? [] : generatePasswords(state, state.count)),
    // `generation` is the "Generate again" trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, generation, error],
  );
  const strength = useMemo(() => estimateStrength(checkText), [checkText]);

  return (
    <div>
      <div className="toolbar">
        <label>
          Length{" "}
          <input
            type="number"
            className="base-input"
            min={MIN_LENGTH}
            max={MAX_LENGTH}
            value={Number.isNaN(state.length) ? "" : state.length}
            onChange={(e) => update({ length: e.target.value === "" ? NaN : clampLength(Number(e.target.value)) })}
          />
        </label>
        <label>
          How many{" "}
          <input
            type="number"
            className="base-input"
            min={1}
            max={MAX_COUNT}
            value={Number.isNaN(state.count) ? "" : state.count}
            onChange={(e) => update({ count: e.target.value === "" ? NaN : clampCount(Number(e.target.value)) })}
          />
        </label>
        <button type="button" className="btn-small" onClick={() => setGeneration((g) => g + 1)}>
          Generate again
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
      </div>
      <div className="toolbar">
        <ToolbarSwitch label="a-z" checked={state.lower} onChange={(lower) => update({ lower })} />
        <ToolbarSwitch label="A-Z" checked={state.upper} onChange={(upper) => update({ upper })} />
        <ToolbarSwitch label="0-9" checked={state.digits} onChange={(digits) => update({ digits })} />
        <ToolbarSwitch label="Symbols" checked={state.symbols} onChange={(symbols) => update({ symbols })} />
        <ToolbarSwitch label="No look-alikes (O 0 l 1 I)" checked={state.excludeAmbiguous} onChange={(excludeAmbiguous) => update({ excludeAmbiguous })} />
        <ToolbarSwitch label="One of each set" checked={state.requireEach} onChange={(requireEach) => update({ requireEach })} />
      </div>
      {!error && (
        <p className="status">
          About {Math.floor(generatedEntropyBits(state))} bits of entropy. Generated with the browser's secure random generator and never sent anywhere.
        </p>
      )}
      <ErrorDisplay error={error} title="Invalid options" />
      <TextPane label={`${passwords.length} generated`} value={passwords.join("\n")} rows={Math.min(Math.max(passwords.length, 3), 12)} />

      <h3 style={{ marginTop: "1.5rem" }}>Strength check</h3>
      <TextPane
        label="Password to check (not saved, not shared)"
        value={checkText}
        onChange={setCheckText}
        placeholder="Type or paste a password"
        rows={2}
        copyable={false}
      />
      {checkText !== "" && (
        <div className="status" role="status">
          <div style={{ display: "flex", gap: "0.25rem", margin: "0.5rem 0" }} aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{ flex: 1, height: 6, borderRadius: 3, background: i <= strength.score ? SCORE_COLORS[strength.score] : "#8884" }}
              />
            ))}
          </div>
          <strong style={{ color: SCORE_COLORS[strength.score] }}>{strength.label}</strong>
          {" · "}
          {strength.length} characters · about {Math.floor(strength.bits)} bits
          <br />
          Guessing time: {strength.crackTime.offline} (fast offline attack, 10 billion guesses/s), {strength.crackTime.online} (online, 10 guesses/s)
          {strength.warnings.length > 0 && (
            <ul>
              {strength.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p style={{ opacity: 0.7 }}>This is an estimate based on length, character types, repeats, sequences and a short list of common passwords. It is not a guarantee.</p>
        </div>
      )}
    </div>
  );
}
