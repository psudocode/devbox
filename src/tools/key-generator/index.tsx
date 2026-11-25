import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { CopyButton, ErrorDisplay, ShareButton, TextPane } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import { bytesToText, randomBytes, textToBytes, type ByteFormat } from "../aes-crypto/logic";
import {
  derivePbkdf2,
  generateKeyPair,
  KEY_TYPES,
  PBKDF2_MAX_BYTES,
  PBKDF2_MAX_ITERATIONS,
  RECOMMENDED_ITERATIONS,
  type GeneratedKeyPair,
  type KeyType,
  type Pbkdf2Hash,
} from "./logic";

export const TOOL_ID = "key-generator";

type Mode = "keypair" | "pbkdf2";
type SaltFormat = "text" | "hex" | "base64";

interface State {
  mode: Mode;
  keyType: KeyType;
  // PBKDF2
  password: string;
  salt: string;
  saltFormat: SaltFormat;
  iterations: string;
  hash: Pbkdf2Hash;
  length: string;
  outFormat: Exclude<ByteFormat, "base64url">;
}

const DEFAULTS: State = {
  mode: "keypair",
  keyType: "ec-p256",
  password: "",
  salt: "",
  saltFormat: "hex",
  iterations: String(RECOMMENDED_ITERATIONS["SHA-256"]),
  hash: "SHA-256",
  length: "32",
  outFormat: "hex",
};

type Pbkdf2Outcome = { ok: true; text: string } | { ok: false; error: string };

async function runPbkdf2(s: State): Promise<Pbkdf2Outcome | null> {
  if (s.password === "") return null;
  let salt: Uint8Array;
  if (s.saltFormat === "text") salt = new TextEncoder().encode(s.salt);
  else {
    const parsed = textToBytes(s.salt, s.saltFormat, "salt");
    if (!parsed.ok) return parsed;
    salt = parsed.bytes;
  }
  const r = await derivePbkdf2({
    password: new TextEncoder().encode(s.password),
    salt,
    iterations: s.iterations === "" ? NaN : Number(s.iterations),
    hash: s.hash,
    length: s.length === "" ? NaN : Number(s.length),
  });
  return r.ok ? { ok: true, text: bytesToText(r.bytes, s.outFormat) } : r;
}

function KeyPairView({ keyType, onKeyType }: { keyType: KeyType; onKeyType: (t: KeyType) => void }) {
  // Generated keys live only in memory: they are never written to storage or share links.
  const [pair, setPair] = useState<GeneratedKeyPair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const result = await generateKeyPair(keyType);
    setBusy(false);
    if (result.ok) setPair(result.pair);
    else {
      setPair(null);
      setError(result.error);
    }
  };

  const note = KEY_TYPES.find((k) => k.id === keyType)?.note;

  return (
    <>
      <div className="toolbar">
        <label>
          Key type{" "}
          <select value={keyType} onChange={(e) => onKeyType(e.target.value as KeyType)}>
            {KEY_TYPES.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <Button appearance="primary" size="small" onClick={generate} disabled={busy}>
          {pair ? "Generate new key pair" : "Generate key pair"}
        </Button>
        {note && <span className="muted small">{note}</span>}
      </div>
      <ErrorDisplay error={error} title="Cannot generate key pair" />
      {busy && <p className="status">Generating…</p>}
      {pair && (
        <>
          <div className="panes">
            <TextPane label="Private key (PKCS#8 PEM)" value={pair.privatePem} rows={10} />
            <TextPane label="Public key (SPKI PEM)" value={pair.publicPem} rows={10} />
          </div>
          <div className="panes">
            <TextPane label="Private key (JWK)" value={pair.privateJwk} rows={10} />
            <TextPane label="Public key (JWK)" value={pair.publicJwk} rows={10} />
          </div>
          <dl className="muted small" style={{ marginTop: "0.75rem" }}>
            <dt>SPKI SHA-256 fingerprint</dt>
            <dd style={{ margin: 0 }}>
              <code>{pair.spkiFingerprint}</code> <CopyButton text={pair.spkiFingerprint} />
            </dd>
            <dt>JWK thumbprint (RFC 7638)</dt>
            <dd style={{ margin: 0 }}>
              <code>{pair.jwkThumbprint}</code> <CopyButton text={pair.jwkThumbprint} />
            </dd>
          </dl>
        </>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        Keys are generated in your browser with WebCrypto and never leave it, and they are not saved or put in share links. Treat the private key like a
        password.
      </p>
    </>
  );
}

function Pbkdf2View({ state, update }: { state: State; update: (patch: Partial<State>) => void }) {
  const [result, setResult] = useState<Pbkdf2Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.password === "") {
      setResult(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      runPbkdf2(state)
        .then((r) => !cancelled && setResult(r))
        .catch((err: unknown) => !cancelled && setResult({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        .finally(() => !cancelled && setBusy(false));
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [state]);

  const randomSalt = () => {
    const bytes = randomBytes(16);
    update({ salt: bytesToText(bytes, state.saltFormat === "base64" ? "base64" : "hex"), saltFormat: state.saltFormat === "base64" ? "base64" : "hex" });
  };

  return (
    <>
      <div className="toolbar">
        <label>
          Hash{" "}
          <select
            value={state.hash}
            onChange={(e) => {
              const hash = e.target.value as Pbkdf2Hash;
              update({ hash, iterations: String(RECOMMENDED_ITERATIONS[hash]) });
            }}
          >
            {(Object.keys(RECOMMENDED_ITERATIONS) as Pbkdf2Hash[]).map((h) => (
              <option key={h} value={h}>
                HMAC-{h}
              </option>
            ))}
          </select>
        </label>
        <label>
          Iterations{" "}
          <input
            className="base-input"
            style={{ width: "8rem" }}
            inputMode="numeric"
            aria-label="Iterations"
            value={state.iterations}
            onChange={(e) => update({ iterations: e.target.value.replace(/[^\d]/g, "") })}
          />
        </label>
        <label>
          Output length (bytes){" "}
          <input
            className="base-input"
            style={{ width: "5rem" }}
            inputMode="numeric"
            aria-label="Output length"
            value={state.length}
            onChange={(e) => update({ length: e.target.value.replace(/[^\d]/g, "") })}
          />
        </label>
        <label>
          Output as{" "}
          <select value={state.outFormat} onChange={(e) => update({ outFormat: e.target.value as State["outFormat"] })}>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
        </label>
        <ShareButton toolId={TOOL_ID} state={{ ...state, password: "", salt: "" }} />
      </div>
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
        <label>
          Salt{" "}
          <input
            className="base-input"
            style={{ width: "18rem" }}
            spellCheck={false}
            aria-label="Salt"
            value={state.salt}
            onChange={(e) => update({ salt: e.target.value })}
          />
        </label>
        <label>
          Salt is{" "}
          <select value={state.saltFormat} onChange={(e) => update({ saltFormat: e.target.value as SaltFormat })}>
            <option value="text">Text</option>
            <option value="hex">Hex</option>
            <option value="base64">Base64</option>
          </select>
        </label>
        <Button size="small" onClick={randomSalt}>
          Random salt
        </Button>
      </div>
      <TextPane label="Derived key" value={result?.ok ? result.text : ""} rows={4} />
      {busy && <p className="status">Working…</p>}
      <ErrorDisplay error={result && !result.ok ? result.error : null} title="Cannot derive key" />
      <p className="muted small" style={{ marginTop: "1rem" }}>
        PBKDF2 (RFC 8018) via WebCrypto, up to {PBKDF2_MAX_ITERATIONS.toLocaleString("en-US")} iterations and {PBKDF2_MAX_BYTES} output bytes. Iteration
        counts follow the OWASP guidance for each hash. The password is saved in this browser like other inputs, but never in share links.
      </p>
    </>
  );
}

export default function KeyGeneratorTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Mode" className="segmented">
          <button type="button" className="btn-small" aria-pressed={state.mode === "keypair"} onClick={() => update({ mode: "keypair" })}>
            Key pair
          </button>
          <button type="button" className="btn-small" aria-pressed={state.mode === "pbkdf2"} onClick={() => update({ mode: "pbkdf2" })}>
            PBKDF2
          </button>
        </div>
      </div>
      {state.mode === "keypair" ? <KeyPairView keyType={state.keyType} onKeyType={(keyType) => update({ keyType })} /> : <Pbkdf2View state={state} update={update} />}
    </div>
  );
}
