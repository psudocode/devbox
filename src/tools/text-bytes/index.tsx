import { useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import {
  asciiTable,
  characterTable,
  decodeBytes,
  encodeText,
  formatByteList,
  parseByteList,
  searchAscii,
  type Base,
  type Encoding,
  type Prefix,
  type Separator,
} from "./logic";

export const TOOL_ID = "text-bytes";

type Mode = "to-bytes" | "to-text";

interface State {
  input: string;
  mode: Mode;
  base: Base;
  encoding: Encoding;
  separator: Separator;
  prefix: Prefix;
  upper: boolean;
  padDecimal: boolean;
}

const DEFAULTS: State = {
  input: "",
  mode: "to-bytes",
  base: 16,
  encoding: "utf-8",
  separator: "space",
  prefix: "none",
  upper: false,
  padDecimal: false,
};

const BASES: { id: Base; label: string }[] = [
  { id: 16, label: "Hex" },
  { id: 2, label: "Binary" },
  { id: 10, label: "Decimal" },
  { id: 8, label: "Octal" },
];

const ASCII = asciiTable();

export default function TextBytesTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));
  const [asciiQuery, setAsciiQuery] = useState("");

  const toBytes = state.mode === "to-bytes";

  const result = useMemo(() => {
    if (state.input === "") return null;
    if (toBytes) {
      const encoded = encodeText(state.input, state.encoding);
      if (!encoded.ok) return encoded;
      return {
        ok: true as const,
        text: formatByteList(encoded.bytes, {
          base: state.base,
          separator: state.separator,
          prefix: state.prefix,
          upper: state.upper,
          padDecimal: state.padDecimal,
        }),
        count: encoded.bytes.length,
      };
    }
    const parsed = parseByteList(state.input, state.base);
    if (!parsed.ok) return parsed;
    const decoded = decodeBytes(parsed.bytes, state.encoding);
    return decoded.ok ? { ok: true as const, text: decoded.text, count: parsed.bytes.length } : decoded;
  }, [state, toBytes]);

  const output = result?.ok ? result.text : "";
  const error = result && !result.ok ? result.error : null;

  const characters = useMemo(() => characterTable(toBytes ? state.input : output), [toBytes, state.input, output]);
  const asciiRows = useMemo(() => searchAscii(ASCII, asciiQuery), [asciiQuery]);

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: toBytes ? "to-text" : "to-bytes" });

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["to-bytes", "to-text"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "to-bytes" ? "Text → bytes" : "Bytes → text"}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Number base" className="segmented">
          {BASES.map(({ id, label }) => (
            <button key={id} type="button" className="btn-small" aria-pressed={state.base === id} onClick={() => update({ base: id })}>
              {label}
            </button>
          ))}
        </div>
        <label>
          Encoding{" "}
          <select value={state.encoding} onChange={(e) => update({ encoding: e.target.value as Encoding })}>
            <option value="utf-8">UTF-8</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
            <option value="latin1">Latin-1 (ISO-8859-1)</option>
            <option value="ascii">ASCII</option>
          </select>
        </label>
        {toBytes && (
          <>
            <label>
              Separator{" "}
              <select value={state.separator} onChange={(e) => update({ separator: e.target.value as Separator })}>
                <option value="space">Space</option>
                <option value="comma">Comma</option>
                <option value="newline">New line</option>
                <option value="none">None</option>
              </select>
            </label>
            <label>
              Prefix{" "}
              <select value={state.prefix} onChange={(e) => update({ prefix: e.target.value as Prefix })}>
                <option value="none">None</option>
                <option value="0x">0x</option>
                <option value="\x">\x</option>
                <option value="%">%</option>
              </select>
            </label>
            {state.base === 16 && (
              <ToolbarSwitch label="Upper-case" checked={state.upper} onChange={(upper) => update({ upper })} />
            )}
            {state.base === 10 && (
              <ToolbarSwitch label="Pad to 3 digits" checked={state.padDecimal} onChange={(padDecimal) => update({ padDecimal })} />
            )}
          </>
        )}
        <button type="button" className="btn-small" onClick={swap} disabled={output === ""}>
          Swap
        </button>
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <div className="panes">
        <TextPane
          label={toBytes ? "Text" : "Bytes"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={toBytes ? "Hello, wörld 🐙" : "48 65 6c 6c 6f   (also 0x48, \\x48, %48 or 48656c6c6f)"}
        />
        <TextPane
          label={toBytes ? "Bytes" : "Text"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      <ErrorDisplay error={error} title={toBytes ? "Cannot encode" : "Cannot decode"} />
      {result?.ok && (
        <p className="status" aria-live="polite">
          {result.count} byte{result.count === 1 ? "" : "s"} · {characters.total} character{characters.total === 1 ? "" : "s"}
        </p>
      )}

      {characters.rows.length > 0 && (
        <details style={{ marginTop: "1rem" }} open={characters.total <= 12}>
          <summary>Characters ({characters.total})</summary>
          <div className="text-diff-wrap">
            <table className="text-diff" aria-label="Characters">
              <thead>
                <tr>
                  <th align="left">Char</th>
                  <th align="left">Code point</th>
                  <th align="left">UTF-8</th>
                  <th align="left">UTF-16</th>
                  <th align="left">Note</th>
                </tr>
              </thead>
              <tbody>
                {characters.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.display}</td>
                    <td>{row.codePoint}</td>
                    <td>{row.utf8}</td>
                    <td>{row.utf16}</td>
                    <td>{row.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {characters.total > characters.rows.length && (
            <p className="muted small">Showing the first {characters.rows.length} of {characters.total} characters.</p>
          )}
        </details>
      )}

      <details style={{ marginTop: "1rem" }}>
        <summary>ASCII table</summary>
        <div className="toolbar" style={{ marginTop: "0.5rem" }}>
          <label>
            Find{" "}
            <input
              type="text"
              className="base-input"
              style={{ width: "14rem" }}
              value={asciiQuery}
              placeholder="65, 0x41, A, LF, tab"
              spellCheck={false}
              onChange={(e) => setAsciiQuery(e.target.value)}
            />
          </label>
          <CopyButton text={asciiRows.map((r) => `${r.dec}\t0x${r.hex}\t${r.oct}\t${r.bin}\t${r.char || r.abbr}`).join("\n")} label="Copy rows" />
        </div>
        <div className="text-diff-wrap" style={{ maxHeight: "24rem" }}>
          <table className="text-diff" aria-label="ASCII table">
            <thead>
              <tr>
                <th align="left">Dec</th>
                <th align="left">Hex</th>
                <th align="left">Oct</th>
                <th align="left">Binary</th>
                <th align="left">Char</th>
                <th align="left">Description</th>
              </tr>
            </thead>
            <tbody>
              {asciiRows.map((r) => (
                <tr key={r.dec}>
                  <td>{r.dec}</td>
                  <td>{r.hex}</td>
                  <td>{r.oct}</td>
                  <td>{r.bin}</td>
                  <td>{r.char === " " ? "SP" : r.char || r.abbr}</td>
                  <td>{r.description}</td>
                </tr>
              ))}
              {asciiRows.length === 0 && (
                <tr>
                  <td colSpan={6}>No match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
