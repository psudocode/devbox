import { useEffect, useState } from "react";
import { ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import {
  bytesToText,
  decryptOpenSsl,
  decryptRaw,
  decryptWithPassword,
  DEFAULT_ITERATIONS,
  encryptOpenSsl,
  encryptRaw,
  encryptWithPassword,
  IV_LENGTH,
  randomBytes,
  textToBytes,
  type ByteFormat,
  type KeyBits,
  type Mode,
} from "./logic";

export const TOOL_ID = "aes-crypto";

type Direction = "encrypt" | "decrypt";
type Scheme = "password" | "openssl" | "raw";

interface State {
  direction: Direction;
  scheme: Scheme;
  cipher: Mode;
  keyBits: KeyBits;
  iterations: string;
  password: string;
  input: string;
  outFormat: ByteFormat;
  key: string;
  iv: string;
  prependIv: boolean;
}

const DEFAULTS: State = {
  direction: "encrypt",
  scheme: "password",
  cipher: "gcm",
  keyBits: 256,
  iterations: String(DEFAULT_ITERATIONS),
  password: "",
  input: "",
  outFormat: "base64",
  key: "",
  iv: "",
  prependIv: true,
};

type Outcome = { ok: true; text: string; note?: string } | { ok: false; error: string };

const toUtf8OrHex = (bytes: Uint8Array): Outcome => {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: true, text: bytesToText(bytes, "hex"), note: "The decrypted bytes are not UTF-8 text, so they are shown as hex." };
  }
};

async function compute(s: State): Promise<Outcome | null> {
  if (s.input === "") return null;
  const encrypting = s.direction === "encrypt";
  const iterations = Number(s.iterations);
  const plaintext = new TextEncoder().encode(s.input);

  // Ciphertext is read from text in the chosen format; for encryption it is written in that format.
  const readCiphertext = () => textToBytes(s.input, s.outFormat, "encrypted text");

  if (s.scheme === "password") {
    if (encrypting) {
      const r = await encryptWithPassword(s.password, plaintext, { mode: s.cipher, keyBits: s.keyBits, iterations });
      return r.ok ? { ok: true, text: bytesToText(r.bytes, s.outFormat) } : r;
    }
    const data = readCiphertext();
    if (!data.ok) return data;
    const r = await decryptWithPassword(s.password, data.bytes);
    return r.ok ? toUtf8OrHex(r.bytes) : r;
  }

  if (s.scheme === "openssl") {
    const options = { keyBits: s.keyBits, iterations };
    if (encrypting) {
      const r = await encryptOpenSsl(s.password, plaintext, options);
      return r.ok ? { ok: true, text: bytesToText(r.bytes, s.outFormat) } : r;
    }
    const data = readCiphertext();
    if (!data.ok) return data;
    const r = await decryptOpenSsl(s.password, data.bytes, options);
    return r.ok ? toUtf8OrHex(r.bytes) : r;
  }

  // raw key
  const keyFormat: ByteFormat = s.outFormat === "hex" ? "hex" : "base64";
  const key = textToBytes(s.key, keyFormat, "key");
  if (!key.ok) return key;
  const ivLength = IV_LENGTH[s.cipher];
  if (encrypting) {
    let iv: Uint8Array;
    if (s.iv.trim() === "") iv = randomBytes(ivLength);
    else {
      const parsed = textToBytes(s.iv, keyFormat, "IV");
      if (!parsed.ok) return parsed;
      iv = parsed.bytes;
    }
    const r = await encryptRaw({ mode: s.cipher, key: key.bytes, iv, plaintext });
    if (!r.ok) return r;
    const out = s.prependIv ? new Uint8Array([...iv, ...r.bytes]) : r.bytes;
    return { ok: true, text: bytesToText(out, s.outFormat), note: s.iv.trim() === "" ? `A random ${ivLength}-byte IV was used and ${s.prependIv ? "put in front of the output" : "NOT included: copy it from below"}.` : undefined };
  }
  const data = readCiphertext();
  if (!data.ok) return data;
  let iv: Uint8Array;
  let body = data.bytes;
  if (s.prependIv) {
    iv = body.subarray(0, ivLength);
    body = body.subarray(ivLength);
    if (iv.length < ivLength) return { ok: false, error: `Expected a ${ivLength}-byte IV in front of the data; there is not enough data.` };
  } else {
    const parsed = textToBytes(s.iv, keyFormat, "IV");
    if (!parsed.ok) return parsed;
    iv = parsed.bytes;
  }
  const r = await decryptRaw({ mode: s.cipher, key: key.bytes, iv, ciphertext: body });
  return r.ok ? toUtf8OrHex(r.bytes) : r;
}

export default function AesCryptoTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  const [result, setResult] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.input === "") {
      setResult(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      compute(state)
        .then((r) => !cancelled && setResult(r))
        .catch((err: unknown) => !cancelled && setResult({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        .finally(() => !cancelled && setBusy(false));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state]);

  const encrypting = state.direction === "encrypt";
  const output = result?.ok ? result.text : "";
  const error = result && !result.ok ? result.error : null;
  const raw = state.scheme === "raw";
  const needsPassword = !raw;
  const cipherLocked = state.scheme === "openssl";
  const cipher = cipherLocked ? "cbc" : state.cipher;
  const ivBytes = IV_LENGTH[cipher];

  const randomIv = () => {
    const bytes = randomBytes(ivBytes);
    update({ iv: bytesToText(bytes, state.outFormat === "hex" ? "hex" : "base64") });
  };
  const randomKey = () => {
    const bytes = randomBytes(state.keyBits / 8);
    update({ key: bytesToText(bytes, state.outFormat === "hex" ? "hex" : "base64") });
  };

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["encrypt", "decrypt"] as const).map((d) => (
            <button key={d} type="button" className="btn-small" aria-pressed={state.direction === d} onClick={() => update({ direction: d })}>
              {d === "encrypt" ? "Encrypt" : "Decrypt"}
            </button>
          ))}
        </div>
        <label>
          Method{" "}
          <select value={state.scheme} onChange={(e) => update({ scheme: e.target.value as Scheme })}>
            <option value="password">Password (self-describing)</option>
            <option value="openssl">Password (OpenSSL compatible)</option>
            <option value="raw">Raw key + IV</option>
          </select>
        </label>
        <label>
          Mode{" "}
          <select value={cipher} disabled={cipherLocked} onChange={(e) => update({ cipher: e.target.value as Mode })}>
            <option value="gcm">AES-GCM (authenticated)</option>
            <option value="cbc">AES-CBC</option>
            <option value="ctr">AES-CTR</option>
          </select>
        </label>
        {(state.scheme !== "password" || encrypting) && (
          <label>
            Key size{" "}
            <select value={state.keyBits} disabled={state.scheme === "password" && !encrypting} onChange={(e) => update({ keyBits: Number(e.target.value) as KeyBits })}>
              <option value={128}>128 bit</option>
              <option value={192}>192 bit</option>
              <option value={256}>256 bit</option>
            </select>
          </label>
        )}
        {needsPassword && (state.scheme === "openssl" || encrypting) && (
          <label>
            PBKDF2 iterations{" "}
            <input
              className="base-input"
              style={{ width: "7rem" }}
              value={state.iterations}
              inputMode="numeric"
              onChange={(e) => update({ iterations: e.target.value.replace(/[^\d]/g, "") })}
            />
          </label>
        )}
        <label>
          Encrypted text as{" "}
          <select value={state.outFormat} onChange={(e) => update({ outFormat: e.target.value as ByteFormat })}>
            <option value="base64">Base64</option>
            <option value="base64url">Base64 (URL-safe)</option>
            <option value="hex">Hex</option>
          </select>
        </label>
        <ShareButton toolId={TOOL_ID} state={{ ...state, password: "", key: "", iv: "", input: "" }} />
      </div>

      {needsPassword ? (
        <div className="toolbar">
          <label>
            Password{" "}
            <input
              className="base-input"
              style={{ width: "18rem" }}
              type="password"
              autoComplete="off"
              value={state.password}
              onChange={(e) => update({ password: e.target.value })}
            />
          </label>
        </div>
      ) : (
        <div className="toolbar">
          <label>
            Key ({state.outFormat === "hex" ? "hex" : "Base64"}){" "}
            <input className="base-input" style={{ width: "24rem" }} type="password" autoComplete="off" spellCheck={false} value={state.key} onChange={(e) => update({ key: e.target.value })} />
          </label>
          <button type="button" className="btn-small" onClick={randomKey}>
            Random key
          </button>
          <label>
            IV ({ivBytes} bytes){" "}
            <input
              className="base-input"
              style={{ width: "20rem" }}
              spellCheck={false}
              disabled={state.prependIv && !encrypting}
              placeholder={encrypting ? "empty = random" : state.prependIv ? "taken from the data" : ""}
              value={state.iv}
              onChange={(e) => update({ iv: e.target.value })}
            />
          </label>
          <button type="button" className="btn-small" onClick={randomIv} disabled={state.prependIv && !encrypting}>
            Random IV
          </button>
          <label>
            <input type="checkbox" checked={state.prependIv} onChange={(e) => update({ prependIv: e.target.checked })} /> IV is the first {ivBytes} bytes of the data
          </label>
        </div>
      )}

      <div className="panes">
        <TextPane
          label={encrypting ? "Text to encrypt" : "Encrypted text"}
          value={state.input}
          onChange={(input) => update({ input })}
          placeholder={encrypting ? "Anything you want to protect" : state.scheme === "openssl" ? "U2FsdGVkX1…" : "Paste the encrypted text"}
        />
        <TextPane
          label={encrypting ? "Encrypted text" : "Decrypted text"}
          value={output}
          actions={<SendToMenu fromToolId={TOOL_ID} value={output} />}
        />
      </div>
      {busy && <p className="status">Working…</p>}
      <ErrorDisplay error={error} title={encrypting ? "Cannot encrypt" : "Cannot decrypt"} />
      {result?.ok && result.note && (
        <p className="status status-bad" role="status">
          {result.note}
        </p>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        Runs in your browser with WebCrypto; nothing is uploaded. The password and key are saved in this browser like other inputs, but never in share
        links.
        {state.scheme === "password" && " Output starts with a small authenticated header (mode, key size, iterations, salt, IV), so only this tool can decrypt it."}
        {state.scheme === "openssl" && " Matches `openssl enc -aes-…-cbc -pbkdf2 -iter N -md sha256`; AES-CBC does not detect tampering."}
        {raw && " Reusing a key + IV pair breaks AES-GCM and AES-CTR completely; leave the IV empty to get a fresh random one."}
      </p>
    </div>
  );
}
