import { useMemo, useState } from "react";
import { ErrorDisplay, ShareButton, TextPane } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import {
  MAX_COUNT,
  NANOID_ALPHABET,
  clampCount,
  generateIds,
  validateNanoidOptions,
  type GenerateOptions,
  type IdKind,
} from "./logic";

export const TOOL_ID = "uuid-generator";

const KINDS: { id: IdKind; label: string; hint: string }[] = [
  { id: "uuid-v4", label: "UUID v4", hint: "Random 122-bit identifier. The common default." },
  { id: "uuid-v7", label: "UUID v7", hint: "Starts with a millisecond timestamp, so ids sort by creation time (good for database keys)." },
  { id: "ulid", label: "ULID", hint: "26 characters, Crockford Base32, sortable by creation time." },
  { id: "nanoid", label: "NanoID", hint: "Short URL-friendly random id with a custom size and alphabet." },
];

// Only options are persisted/shared: generated ids are random and should never be stored or linked.
const DEFAULTS: GenerateOptions = {
  kind: "uuid-v4",
  count: 5,
  uppercase: false,
  hyphens: true,
  nanoidSize: 21,
  nanoidAlphabet: NANOID_ALPHABET,
};

export default function UuidGenerator() {
  const [options, setOptions] = useToolState<GenerateOptions>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<GenerateOptions>) => setOptions((s) => ({ ...s, ...patch }));
  const [generation, setGeneration] = useState(0);

  const optionsError =
    options.kind === "nanoid" ? validateNanoidOptions(options.nanoidAlphabet, options.nanoidSize) : null;

  const ids = useMemo(
    () => (optionsError ? [] : generateIds(options)),
    // `generation` is the "Generate again" trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options, generation, optionsError],
  );

  const kind = KINDS.find((k) => k.id === options.kind) ?? KINDS[0];
  const isUuid = options.kind === "uuid-v4" || options.kind === "uuid-v7";

  return (
    <div>
      <div className="toolbar">
        <label>
          Type{" "}
          <select value={options.kind} onChange={(e) => update({ kind: e.target.value as IdKind })}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          How many{" "}
          <input
            type="number"
            className="base-input"
            min={1}
            max={MAX_COUNT}
            value={Number.isNaN(options.count) ? "" : options.count}
            onChange={(e) => update({ count: e.target.value === "" ? NaN : clampCount(Number(e.target.value)) })}
          />
        </label>
        {(isUuid || options.kind === "ulid") && (
          <label>
            <input type="checkbox" checked={options.uppercase} onChange={(e) => update({ uppercase: e.target.checked })} /> Uppercase
          </label>
        )}
        {isUuid && (
          <label>
            <input type="checkbox" checked={options.hyphens} onChange={(e) => update({ hyphens: e.target.checked })} /> Hyphens
          </label>
        )}
        <button type="button" className="btn-small" onClick={() => setGeneration((g) => g + 1)}>
          Generate again
        </button>
        <ShareButton toolId={TOOL_ID} state={options} />
      </div>
      <p className="status">{kind.hint}</p>

      {options.kind === "nanoid" && (
        <div className="toolbar">
          <label>
            Size{" "}
            <input
              type="number"
              className="base-input"
              min={1}
              max={256}
              value={Number.isNaN(options.nanoidSize) ? "" : options.nanoidSize}
              onChange={(e) => update({ nanoidSize: e.target.value === "" ? NaN : Number(e.target.value) })}
            />
          </label>
          <label style={{ flex: 1, minWidth: "16rem" }}>
            Alphabet{" "}
            <input
              type="text"
              className="pane-text"
              style={{ width: "100%" }}
              value={options.nanoidAlphabet}
              spellCheck={false}
              onChange={(e) => update({ nanoidAlphabet: e.target.value })}
            />
          </label>
          <button type="button" className="btn-small" onClick={() => update({ nanoidAlphabet: NANOID_ALPHABET, nanoidSize: 21 })}>
            Reset
          </button>
        </div>
      )}

      <ErrorDisplay error={optionsError} title="Invalid options" />
      <TextPane label={`${ids.length} generated`} value={ids.join("\n")} rows={Math.min(Math.max(ids.length, 3), 20)} />
    </div>
  );
}
