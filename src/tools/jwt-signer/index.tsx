import { useEffect, useState } from "react";
import { CopyButton, ErrorDisplay, SendToMenu, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { ALGORITHMS, setClaim, signJwt, verifyJwt, type Algorithm, type SecretEncoding, type SignResult, type VerifyResult } from "./logic";

export const TOOL_ID = "jwt-signer";

type Mode = "sign" | "verify";

interface State {
  mode: Mode;
  alg: Algorithm;
  header: string;
  payload: string;
  token: string;
  key: string;
  secretEncoding: SecretEncoding;
}

const DEFAULTS: State = {
  mode: "sign",
  alg: "HS256",
  header: '{\n  "typ": "JWT"\n}',
  payload: '{\n  "sub": "1234567890",\n  "name": "John Doe"\n}',
  token: "",
  key: "",
  secretEncoding: "utf8",
};

const isHmac = (alg: Algorithm) => alg.startsWith("HS");

const TIME_TEXT = {
  valid: "not expired",
  expired: "expired",
  "not-yet-valid": "not valid yet (nbf is in the future)",
  "no-expiry": "has no exp claim",
} as const;

export default function JwtSignerTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ mode: "verify", token: text }));

  const [signed, setSigned] = useState<SignResult | null>(null);
  const [verified, setVerified] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const { mode, alg, header, payload, token, key, secretEncoding } = state;

  useEffect(() => {
    const active = mode === "sign" ? payload.trim() !== "" && key.trim() !== "" : token.trim() !== "" && key.trim() !== "";
    if (!active) {
      setSigned(null);
      setVerified(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const options = { secretEncoding };
    const timer = window.setTimeout(() => {
      const run =
        mode === "sign"
          ? signJwt({ header: header.trim() === "" ? "{}" : header, payload, alg, key, options }).then((r) => !cancelled && (setSigned(r), setVerified(null)))
          : verifyJwt({ token, alg, key, options, nowMs: Date.now() }).then((r) => !cancelled && (setVerified(r), setSigned(null)));
      void run.finally(() => !cancelled && setBusy(false));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, alg, header, payload, token, key, secretEncoding]);

  const nowSeconds = () => Date.now() / 1000;
  const claimButton = (label: string, claim: "iat" | "exp" | "nbf", offset: number) => (
    <button type="button" className="btn-small" onClick={() => update({ payload: setClaim(payload, claim, nowSeconds() + offset) })}>
      {label}
    </button>
  );

  const keyLabel = isHmac(alg)
    ? "Secret"
    : mode === "sign"
      ? "Private key (PKCS#8 PEM or JWK)"
      : "Public key (SPKI PEM or JWK) — a private key works too";
  const keyPlaceholder = isHmac(alg)
    ? "your-256-bit-secret"
    : mode === "sign"
      ? "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
      : "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----";

  const error = mode === "sign" ? (signed && !signed.ok ? signed.error : null) : verified && !verified.ok ? verified.error : null;
  const token_ = signed?.ok ? signed.token : "";

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Mode" className="segmented">
          {(["sign", "verify"] as const).map((m) => (
            <button key={m} type="button" className="btn-small" aria-pressed={mode === m} onClick={() => update({ mode: m })}>
              {m === "sign" ? "Sign" : "Verify"}
            </button>
          ))}
        </div>
        <label>
          Algorithm{" "}
          <select value={alg} onChange={(e) => update({ alg: e.target.value as Algorithm })}>
            {ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {isHmac(alg) && (
          <label>
            Secret is{" "}
            <select value={secretEncoding} onChange={(e) => update({ secretEncoding: e.target.value as SecretEncoding })}>
              <option value="utf8">UTF-8 text</option>
              <option value="base64">Base64</option>
            </select>
          </label>
        )}
        {mode === "sign" && (
          <>
            {claimButton("iat = now", "iat", 0)}
            {claimButton("exp +1 h", "exp", 3600)}
            {claimButton("exp +24 h", "exp", 86400)}
            {claimButton("nbf = now", "nbf", 0)}
          </>
        )}
        <ShareButton toolId={TOOL_ID} state={{ ...state, key: "" }} />
      </div>

      {mode === "sign" ? (
        <div className="panes">
          <TextPane label="Header (alg is set for you)" value={header} rows={5} onChange={(v) => update({ header: v })} />
          <TextPane label="Payload (JSON claims)" value={payload} rows={5} onChange={(v) => update({ payload: v })} />
        </div>
      ) : (
        <TextPane
          label="Token"
          value={token}
          rows={5}
          onChange={(v) => update({ token: v })}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
        />
      )}

      <div className="pane" style={{ marginTop: "0.75rem" }}>
        <div className="pane-header">
          <label htmlFor="jwt-key">{keyLabel}</label>
        </div>
        <textarea
          id="jwt-key"
          className="pane-text"
          rows={isHmac(alg) ? 2 : 6}
          value={key}
          placeholder={keyPlaceholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => update({ key: e.target.value })}
        />
        <span className="muted small">The key is saved in this browser like other inputs, but never included in share links.</span>
      </div>

      <ErrorDisplay error={error} title={mode === "sign" ? "Cannot sign" : "Cannot verify"} />
      {busy && <p className="status">Working…</p>}

      {mode === "sign" && signed?.ok && (
        <>
          <div className="pane" style={{ marginTop: "0.75rem" }}>
            <TextPane
              label="Signed token"
              value={token_}
              rows={5}
              actions={
                <>
                  <button type="button" className="btn-small" onClick={() => update({ mode: "verify", token: token_ })}>
                    Verify this token
                  </button>
                  <SendToMenu fromToolId={TOOL_ID} value={token_} />
                </>
              }
            />
          </div>
          {signed.warnings.map((w) => (
            <p key={w} className="status status-bad" role="status">
              {w}
            </p>
          ))}
        </>
      )}

      {mode === "verify" && verified?.ok && (
        <>
          <p className={verified.signatureValid ? "status" : "status status-bad"} role="status" aria-live="polite">
            {verified.signatureValid ? "✓ Signature is valid" : "✗ Signature does NOT match"} · {verified.decoded.algorithm} · token {TIME_TEXT[verified.time]}
          </p>
          {verified.warnings.map((w) => (
            <p key={w} className="status status-bad" role="status">
              {w}
            </p>
          ))}
          {!verified.signatureValid && verified.warnings.length === 0 && (
            <p className="muted small">The key may be wrong, or the token was changed after it was signed. Do not trust the claims below.</p>
          )}
          <div className="panes">
            <TextPane label="Header" value={verified.decoded.header.pretty} rows={6} />
            <TextPane
              label={verified.signatureValid ? "Payload" : "Payload (NOT verified)"}
              value={verified.decoded.payload.pretty}
              rows={6}
              actions={<CopyButton text={verified.decoded.payload.pretty} />}
            />
          </div>
        </>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        Signing and verifying happen in your browser with WebCrypto. When verifying, the algorithm is the one you pick here: a token that claims a
        different algorithm, or "none", is rejected.
      </p>
    </div>
  );
}
