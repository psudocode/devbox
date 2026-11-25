import { useMemo, type ReactNode } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import {
  applyBitOp,
  bigIntToBytes,
  bytesToHex,
  decodeFlags,
  endianness,
  groupBinary,
  MAX_BITS,
  parseFlagDefinitions,
  parseHexBytes,
  parseInteger,
  twosComplement,
  type BitOp,
} from "./logic";

export const TOOL_ID = "bit-tools";

type Section = "twos" | "endian" | "flags";

interface State {
  section: Section;
  // two's complement
  value: string;
  bits: string;
  // endianness
  bytesText: string;
  endianKind: "bytes" | "integer";
  endianSize: string;
  // bit flags
  flagValue: string;
  flagBits: string;
  flagDefs: string;
}

const DEFAULTS: State = {
  section: "twos",
  value: "-1",
  bits: "8",
  bytesText: "12 34 56 78",
  endianKind: "bytes",
  endianSize: "4",
  flagValue: "5",
  flagBits: "8",
  flagDefs: "READ = 1\nWRITE = 2\nEXEC = 4\nHIDDEN = 8",
};

const SECTIONS: { id: Section; label: string }[] = [
  { id: "twos", label: "Two's complement" },
  { id: "endian", label: "Endianness" },
  { id: "flags", label: "Bit flags" },
];

function Row({ label, children, copy }: { label: string; children: ReactNode; copy?: string }) {
  return (
    <div className="result-row">
      <dt>{label}</dt>
      <dd>
        <code>{children}</code>
        {copy !== undefined && <CopyButton text={copy} />}
      </dd>
    </div>
  );
}

const WIDTHS = ["8", "16", "32", "64", "128"];

function WidthSelect({ value, onChange, label = "Width" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const custom = !WIDTHS.includes(value);
  return (
    <>
      <label>
        {label}{" "}
        <select value={custom ? "custom" : value} onChange={(e) => onChange(e.target.value === "custom" ? "12" : e.target.value)}>
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} bits
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {custom && (
        <input
          className="base-input"
          type="number"
          min={1}
          max={MAX_BITS}
          value={value}
          aria-label={`${label} in bits`}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
}

const parseWidth = (text: string, max = MAX_BITS): number | null => {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

function TwosComplementPanel({ state, update }: { state: State; update: (p: Partial<State>) => void }) {
  const parsed = useMemo(() => parseInteger(state.value), [state.value]);
  const width = parseWidth(state.bits);
  const result = parsed.ok && width ? twosComplement(parsed.value, width) : null;
  const error = !parsed.ok ? parsed.error : width ? null : `Width must be a whole number from 1 to ${MAX_BITS}.`;

  return (
    <>
      <div className="toolbar">
        <label>
          Number{" "}
          <input
            className="base-input"
            style={{ width: "16rem" }}
            value={state.value}
            spellCheck={false}
            placeholder="-1, 255, 0xFF, 0b1010"
            onChange={(e) => update({ value: e.target.value })}
          />
        </label>
        <WidthSelect value={state.bits} onChange={(bits) => update({ bits })} />
      </div>
      <ErrorDisplay error={error} title="Cannot convert" />
      {result && (
        <>
          {!result.fits && (
            <p className="status status-bad" role="status">
              {parsed.ok ? parsed.value.toString() : ""} does not fit in {result.bits} bits (signed {result.minSigned.toString()} to{" "}
              {result.maxSigned.toString()}, unsigned 0 to {result.maxUnsigned.toString()}). It wrapped around.
            </p>
          )}
          <dl className="results">
            <Row label="Signed" copy={result.signed.toString()}>{result.signed.toString()}</Row>
            <Row label="Unsigned" copy={result.unsigned.toString()}>{result.unsigned.toString()}</Row>
            <Row label="Binary" copy={result.binary}>{groupBinary(result.binary)}</Row>
            <Row label="Hex" copy={`0x${result.hex}`}>0x{result.hex}</Row>
            <Row label="Signed range">
              {result.minSigned.toString()} … {result.maxSigned.toString()}
            </Row>
            <Row label="Unsigned range">0 … {result.maxUnsigned.toString()}</Row>
          </dl>
          {result.steps && (
            <details open style={{ marginTop: "1rem" }}>
              <summary>How to get this by hand</summary>
              <ol>
                <li>
                  Write the absolute value in {result.bits} bits: <code>{groupBinary(result.steps.absolute)}</code>
                </li>
                <li>
                  Flip every bit: <code>{groupBinary(result.steps.inverted)}</code>
                </li>
                <li>
                  Add one: <code>{groupBinary(result.steps.plusOne)}</code>
                </li>
              </ol>
            </details>
          )}
        </>
      )}
    </>
  );
}

function EndiannessPanel({ state, update }: { state: State; update: (p: Partial<State>) => void }) {
  const analysis = useMemo(() => {
    if (state.endianKind === "bytes") {
      const bytes = parseHexBytes(state.bytesText);
      return bytes.ok ? { ok: true as const, bytes: bytes.bytes } : bytes;
    }
    const value = parseInteger(state.bytesText);
    const size = parseWidth(state.endianSize, MAX_BITS / 8);
    if (!value.ok) return value;
    if (!size) return { ok: false as const, error: `Size must be a whole number from 1 to ${MAX_BITS / 8} bytes.` };
    if (value.value < 0n) return { ok: false as const, error: "Use a non-negative number, or the Two's complement section for negative values." };
    if (value.value >> BigInt(size * 8) !== 0n) return { ok: false as const, error: `${value.value.toString()} needs more than ${size} byte${size === 1 ? "" : "s"}.` };
    return { ok: true as const, bytes: bigIntToBytes(value.value, size, false) };
  }, [state.bytesText, state.endianKind, state.endianSize]);

  const view = analysis.ok ? endianness(analysis.bytes) : null;
  const hex = (n: bigint, size: number) => `0x${n.toString(16).toUpperCase().padStart(size * 2, "0")}`;

  return (
    <>
      <div className="toolbar">
        <div role="group" aria-label="Input" className="segmented">
          {(["bytes", "integer"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="btn-small"
              aria-pressed={state.endianKind === kind}
              onClick={() => update({ endianKind: kind })}
            >
              {kind === "bytes" ? "Bytes (hex)" : "Integer"}
            </button>
          ))}
        </div>
        <label>
          {state.endianKind === "bytes" ? "Bytes" : "Number"}{" "}
          <input
            className="base-input"
            style={{ width: "20rem" }}
            value={state.bytesText}
            spellCheck={false}
            placeholder={state.endianKind === "bytes" ? "12 34 56 78  or  0x12345678" : "305419896 or 0x12345678"}
            onChange={(e) => update({ bytesText: e.target.value })}
          />
        </label>
        {state.endianKind === "integer" && (
          <label>
            Size{" "}
            <select value={state.endianSize} onChange={(e) => update({ endianSize: e.target.value })}>
              {["1", "2", "4", "8", "16", "32"].map((s) => (
                <option key={s} value={s}>
                  {s} byte{s === "1" ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ErrorDisplay error={analysis.ok ? null : analysis.error} title="Cannot read the bytes" />
      {view && (
        <dl className="results">
          <Row label={state.endianKind === "integer" ? "Big endian bytes" : "As entered"} copy={bytesToHex(view.input)}>
            {bytesToHex(view.input)}
          </Row>
          <Row label={state.endianKind === "integer" ? "Little endian bytes" : "Reversed (byte swap)"} copy={bytesToHex(view.swapped)}>
            {bytesToHex(view.swapped)}
          </Row>
          <Row label="Read as big endian" copy={view.asBigEndian.toString()}>
            {view.asBigEndian.toString()} ({hex(view.asBigEndian, view.size)})
          </Row>
          <Row label="Read as little endian" copy={view.asLittleEndian.toString()}>
            {view.asLittleEndian.toString()} ({hex(view.asLittleEndian, view.size)})
          </Row>
          {view.wordSwapped && view.size > 4 && (
            <Row label="Each 32-bit word swapped" copy={bytesToHex(view.wordSwapped)}>
              {bytesToHex(view.wordSwapped)}
            </Row>
          )}
        </dl>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        Network byte order is big endian (most significant byte first); x86 and ARM (little-endian mode) store the least significant byte first.
      </p>
    </>
  );
}

function FlagsPanel({ state, update }: { state: State; update: (p: Partial<State>) => void }) {
  const parsed = useMemo(() => parseInteger(state.flagValue), [state.flagValue]);
  const width = parseWidth(state.flagBits, 64) ?? 8;
  const defs = useMemo(() => parseFlagDefinitions(state.flagDefs), [state.flagDefs]);

  const value = parsed.ok ? parsed.value : null;
  const masked = value !== null && value >= 0n ? value & ((1n << BigInt(width)) - 1n) : null;
  const decoded = masked !== null ? decodeFlags(masked, defs.flags) : null;

  const setValue = (next: bigint) => update({ flagValue: `0x${next.toString(16).toUpperCase()}` });
  const op = (kind: BitOp, operand = 0n) => masked !== null && setValue(applyBitOp(masked, kind, operand, width));

  const error = !parsed.ok ? parsed.error : value !== null && value < 0n ? "Use a non-negative number, or the Two's complement section for negative values." : null;

  return (
    <>
      <div className="toolbar">
        <label>
          Value{" "}
          <input
            className="base-input"
            style={{ width: "14rem" }}
            value={state.flagValue}
            spellCheck={false}
            placeholder="5, 0x05, 0b101"
            onChange={(e) => update({ flagValue: e.target.value })}
          />
        </label>
        <WidthSelect value={state.flagBits} onChange={(flagBits) => update({ flagBits })} />
        <button type="button" className="btn-small" onClick={() => op("not")} disabled={masked === null}>
          NOT
        </button>
        <button type="button" className="btn-small" onClick={() => op("shl", 1n)} disabled={masked === null}>
          {"<< 1"}
        </button>
        <button type="button" className="btn-small" onClick={() => op("shr", 1n)} disabled={masked === null}>
          {">> 1"}
        </button>
        <button type="button" className="btn-small" onClick={() => setValue(0n)}>
          Zero
        </button>
      </div>
      <ErrorDisplay error={error} title="Cannot read the value" />
      {value !== null && masked !== null && masked !== value && (
        <p className="status status-bad" role="status">
          Only the lowest {width} bits are shown; the value has higher bits set.
        </p>
      )}

      {masked !== null && (
        <>
          <fieldset style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: "var(--borderRadiusMedium)", margin: "0 0 1rem" }}>
            <legend>Bits (click to toggle)</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
              {Array.from({ length: width }, (_, i) => width - 1 - i).map((bit) => {
                const on = ((masked >> BigInt(bit)) & 1n) === 1n;
                return (
                  <button
                    key={bit}
                    type="button"
                    className="btn-small"
                    aria-pressed={on}
                    aria-label={`Bit ${bit}`}
                    title={`Bit ${bit} = ${1n << BigInt(bit)}`}
                    onClick={() => op("toggle", BigInt(bit))}
                    style={{ minWidth: "2.2rem", flexDirection: "column", height: "auto", padding: "0.15rem 0.3rem" }}
                  >
                    <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>{bit}</span>
                    <span>{on ? "1" : "0"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <dl className="results">
            <Row label="Decimal" copy={masked.toString()}>{masked.toString()}</Row>
            <Row label="Hex" copy={`0x${masked.toString(16).toUpperCase()}`}>0x{masked.toString(16).toUpperCase().padStart(Math.ceil(width / 4), "0")}</Row>
            <Row label="Binary" copy={masked.toString(2).padStart(width, "0")}>{groupBinary(masked.toString(2).padStart(width, "0"))}</Row>
            {decoded && defs.flags.length > 0 && (
              <Row label="Flags set" copy={decoded.set.join(" | ")}>
                {decoded.set.length > 0 ? decoded.set.join(" | ") : "(none)"}
                {decoded.unknown !== 0n ? `  + unnamed bits 0x${decoded.unknown.toString(16).toUpperCase()}` : ""}
              </Row>
            )}
          </dl>
        </>
      )}

      <div className="pane" style={{ marginTop: "1rem" }}>
        <div className="pane-header">
          <label htmlFor="flag-defs">Flag names (NAME = value, NAME: 4, EXEC = 1 &lt;&lt; 2, bit 5 ARCHIVE)</label>
        </div>
        <textarea
          id="flag-defs"
          className="pane-text"
          rows={6}
          value={state.flagDefs}
          spellCheck={false}
          onChange={(e) => update({ flagDefs: e.target.value })}
        />
      </div>
      <ErrorDisplay error={defs.errors.length > 0 ? defs.errors.join("\n") : null} title="Flag definitions" />
      {masked !== null && defs.flags.length > 0 && (
        <div className="toolbar" style={{ marginTop: "0.75rem" }}>
          {defs.flags.map((flag) => {
            const on = (masked & flag.mask) === flag.mask;
            return (
              <button
                key={flag.name}
                type="button"
                className="btn-small"
                aria-pressed={on}
                title={`mask 0x${flag.mask.toString(16).toUpperCase()}`}
                onClick={() => setValue(on ? masked & ~flag.mask : masked | flag.mask)}
              >
                {flag.name}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function BitToolsTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Tool" className="segmented">
          {SECTIONS.map(({ id, label }) => (
            <button key={id} type="button" className="btn-small" aria-pressed={state.section === id} onClick={() => update({ section: id })}>
              {label}
            </button>
          ))}
        </div>
        <ShareButton toolId={TOOL_ID} state={state} />
      </div>
      {state.section === "twos" && <TwosComplementPanel state={state} update={update} />}
      {state.section === "endian" && <EndiannessPanel state={state} update={update} />}
      {state.section === "flags" && <FlagsPanel state={state} update={update} />}
    </div>
  );
}
