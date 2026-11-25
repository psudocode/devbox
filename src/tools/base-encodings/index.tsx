import { useMemo } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { formatByteList, parseByteList } from "../text-bytes/logic";
import {
  base32Decode,
  base32Encode,
  base58Decode,
  base58Encode,
  domainToAscii,
  domainToUnicode,
  punycodeDecode,
  punycodeEncode,
  type Base32Variant,
  type Base58Alphabet,
} from "./logic";

export const TOOL_ID = "base-encodings";

type Kind = "base32" | "base58" | "punycode";
type Mode = "encode" | "decode";
type DataView = "text" | "hex";

interface State {
  input: string;
  kind: Kind;
  mode: Mode;
  variant32: Base32Variant;
  padding: boolean;
  alphabet58: Base58Alphabet;
  /** How the non-encoded side (the bytes) is written: UTF-8 text or hex. */
  data: DataView;
  /** Punycode: treat input as a domain name (xn-- labels) instead of one raw label. */
  domain: boolean;
}

const DEFAULTS: State = {
  input: "",
  kind: "base32",
  mode: "encode",
  variant32: "rfc4648",
  padding: true,
  alphabet58: "bitcoin",
  data: "text",
  domain: true,
};

const KINDS: { id: Kind; label: string }[] = [
  { id: "base32", label: "Base32" },
  { id: "base58", label: "Base58" },
  { id: "punycode", label: "Punycode" },
];

type Outcome = { ok: true; text: string; warnings: string[] } | { ok: false; error: string };

function bytesFromInput(state: State): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  if (state.data === "text") return { ok: true, bytes: new TextEncoder().encode(state.input) };
  return parseByteList(state.input, 16);
}

function bytesToOutput(bytes: Uint8Array, data: DataView): Outcome {
  if (data === "hex") return { ok: true, text: formatByteList(bytes, { base: 16, separator: "space", prefix: "none", upper: false, padDecimal: false }), warnings: [] };
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), warnings: [] };
  } catch {
    return { ok: false, error: 'The decoded bytes are not valid UTF-8 text. Switch "Bytes as" to Hex to see them.' };
  }
}

function run(state: State): Outcome | null {
  if (state.input.trim() === "" && state.kind !== "punycode") return null;
  if (state.input === "") return null;

  if (state.kind === "punycode") {
    if (state.domain) {
      const r = state.mode === "encode" ? domainToAscii(state.input.trim()) : domainToUnicode(state.input.trim());
      return { ok: true, text: r.text, warnings: r.warnings };
    }
    if (state.mode === "encode") return { ok: true, text: punycodeEncode(state.input), warnings: [] };
    const r = punycodeDecode(state.input.trim());
    return r.ok ? { ok: true, text: r.text, warnings: [] } : r;
  }

  if (state.mode === "encode") {
    const bytes = bytesFromInput(state);
    if (!bytes.ok) return bytes;
    if (state.kind === "base32") return { ok: true, text: base32Encode(bytes.bytes, state.variant32, state.padding), warnings: [] };
    const r = base58Encode(bytes.bytes, state.alphabet58);
    return r.ok ? { ok: true, text: r.text, warnings: [] } : r;
  }
  const decoded = state.kind === "base32" ? base32Decode(state.input, state.variant32) : base58Decode(state.input, state.alphabet58);
  return decoded.ok ? bytesToOutput(decoded.bytes, state.data) : decoded;
}

export default function BaseEncodingsTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const result = useMemo(() => run(state), [state]);
  const output = result?.ok ? result.text : "";
  const error = result && !result.ok ? result.error : null;
  const encoding = state.mode === "encode";

  /** Use the output as the new input and flip the direction. */
  const swap = () => update({ input: output, mode: encoding ? "decode" : "encode" });

  const inputLabel =
    state.kind === "punycode"
      ? state.domain
        ? encoding ? "Domain name" : "Domain name (xn--…)"
        : encoding ? "Text" : "Punycode"
      : encoding ? (state.data === "hex" ? "Bytes (hex)" : "Text") : state.kind === "base32" ? "Base32" : "Base58";
  const outputLabel =
    state.kind === "punycode"
      ? state.domain
        ? encoding ? "ASCII domain (xn--…)" : "Domain name"
        : encoding ? "Punycode" : "Text"
      : encoding ? (state.kind === "base32" ? "Base32" : "Base58") : state.data === "hex" ? "Bytes (hex)" : "Text";

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Encoding" className="segmented">
          {KINDS.map(({ id, label }) => (
            <button key={id} type="button" className="btn-small" aria-pressed={state.kind === id} onClick={() => update({ kind: id })}>
              {label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Mode" className="segmented">
          {(["encode", "decode"] as const).map((mode) => (
            <button key={mode} type="button" className="btn-small" aria-pressed={state.mode === mode} onClick={() => update({ mode })}>
              {mode === "encode" ? "Encode" : "Decode"}
            </button>
          ))}
        </div>
        {state.kind === "base32" && (
          <>
            <label>
              Variant{" "}
              <select value={state.variant32} onChange={(e) => update({ variant32: e.target.value as Base32Variant })}>
                <option value="rfc4648">RFC 4648 (A–Z 2–7)</option>
                <option value="hex">Extended hex (0–9 A–V)</option>
                <option value="crockford">Crockford</option>
              </select>
            </label>
            {encoding && state.variant32 !== "crockford" && (
              <ToolbarSwitch label="Padding (=)" checked={state.padding} onChange={(padding) => update({ padding })} />
            )}
          </>
        )}
        {state.kind === "base58" && (
          <label>
            Alphabet{" "}
            <select value={state.alphabet58} onChange={(e) => update({ alphabet58: e.target.value as Base58Alphabet })}>
              <option value="bitcoin">Bitcoin</option>
              <option value="flickr">Flickr</option>
              <option value="ripple">Ripple</option>
            </select>
          </label>
        )}
        {state.kind !== "punycode" && (
          <label>
            Bytes as{" "}
            <select value={state.data} onChange={(e) => update({ data: e.target.value as DataView })}>
              <option value="text">UTF-8 text</option>
              <option value="hex">Hex</option>
            </select>
          </label>
        )}
        {state.kind === "punycode" && (
          <ToolbarSwitch label="Domain name (per label)" checked={state.domain} onChange={(domain) => update({ domain })} />
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
          label={inputLabel}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={state.kind === "punycode" ? "münchen.de" : state.data === "hex" && encoding ? "48 65 6c 6c 6f" : "Hello, world"}
        />
        <TextPane label={outputLabel} value={output} actions={<SendToMenu fromToolId={TOOL_ID} value={output} />} />
      </div>
      <ErrorDisplay error={error} title="Cannot convert" />
      {result?.ok && result.warnings.length > 0 && (
        <div role="status" className="status status-bad">
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
