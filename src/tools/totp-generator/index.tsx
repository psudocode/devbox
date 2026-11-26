import { useEffect, useState } from "react";
import { CopyButton, ErrorDisplay, ShareButton, TextPane } from "../../components/ui";
import { useToolState } from "../../lib/useToolState";
import {
  DEFAULT_PARAMS,
  OTP_ALGORITHMS,
  OTP_DIGITS,
  buildOtpAuthUri,
  generateSecret,
  parseOtpAuthUri,
  parseSecret,
  totp,
  totpWindow,
  verifyTotp,
  type OtpAlgorithm,
  type OtpParams,
  type TotpResult,
} from "./logic";

export const TOOL_ID = "totp-generator";

// Only the parameters are persisted/shared. The secret is a credential: it lives in memory only.
const DEFAULTS: OtpParams = DEFAULT_PARAMS;

interface Live {
  result: TotpResult | null;
  neighbors: { offset: number; code: string }[];
}

export default function TotpGenerator() {
  const [params, setParams] = useToolState<OtpParams>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<OtpParams>) => setParams((s) => ({ ...s, ...patch }));

  const [secretText, setSecretText] = useState("");
  const [label, setLabel] = useState("");
  const [issuer, setIssuer] = useState("");
  const [uriText, setUriText] = useState("");
  const [uriError, setUriError] = useState<string | null>(null);
  const [checkCode, setCheckCode] = useState("");
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [live, setLive] = useState<Live>({ result: null, neighbors: [] });

  const secret = parseSecret(secretText);
  const secretError = secretText.trim() !== "" && !secret.ok ? secret.error : null;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!secret.ok) {
      setLive({ result: null, neighbors: [] });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [result, neighbors] = await Promise.all([totp(secret.bytes, now, params), totpWindow(secret.bytes, now, params, 1)]);
        if (!cancelled) setLive({ result, neighbors });
      } catch {
        if (!cancelled) setLive({ result: null, neighbors: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `secret` is derived from `secretText`; depend on the text so the effect does not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretText, params, Math.floor(now / 1000)]);

  const applyUri = () => {
    const parsed = parseOtpAuthUri(uriText);
    if (!parsed.ok) {
      setUriError(parsed.error);
      return;
    }
    if (parsed.value.type === "hotp") {
      setUriError("This is a counter-based (HOTP) URI. This tool generates time-based (TOTP) codes only.");
      return;
    }
    setUriError(null);
    setSecretText(parsed.value.secret);
    setLabel(parsed.value.label.includes(":") ? parsed.value.label.slice(parsed.value.label.indexOf(":") + 1) : parsed.value.label);
    setIssuer(parsed.value.issuer);
    update({ algorithm: parsed.value.algorithm, digits: parsed.value.digits, period: parsed.value.period });
  };

  const runCheck = async () => {
    if (!secret.ok) return;
    const offset = await verifyTotp(secret.bytes, checkCode, now, params, 1);
    setCheckResult(
      offset === null
        ? "No match within one step before or after the current time."
        : offset === 0
          ? "Valid: matches the current code."
          : `Valid, but from ${Math.abs(offset) * params.period} seconds ${offset < 0 ? "ago" : "in the future"} (clock drift is common).`,
    );
  };

  const outUri = secret.ok
    ? buildOtpAuthUri({ type: "totp", label: label || "account", issuer, secret: secretText, ...params })
    : "";
  const code = live.result?.code ?? "";
  const grouped = code.length > 4 ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}` : code;

  return (
    <div>
      <div className="toolbar">
        <label>
          Algorithm{" "}
          <select value={params.algorithm} onChange={(e) => update({ algorithm: e.target.value as OtpAlgorithm })}>
            {OTP_ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Digits{" "}
          <select value={params.digits} onChange={(e) => update({ digits: Number(e.target.value) })}>
            {OTP_DIGITS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period (s){" "}
          <input
            type="number"
            className="base-input"
            min={1}
            max={3600}
            value={Number.isNaN(params.period) ? "" : params.period}
            onChange={(e) => update({ period: e.target.value === "" ? NaN : Number(e.target.value) })}
          />
        </label>
        <button type="button" className="btn-small" onClick={() => setSecretText(generateSecret())}>
          Random secret
        </button>
        <ShareButton toolId={TOOL_ID} state={params} />
      </div>
      <p className="status">The secret never leaves this page and is not saved or included in share links. Defaults (SHA-1, 6 digits, 30 s) match Google Authenticator and most services.</p>

      <TextPane
        label="Secret (Base32)"
        value={secretText}
        onChange={(v) => {
          setSecretText(v);
          setCheckResult(null);
        }}
        placeholder="e.g. JBSW Y3DP EHPK 3PXP"
        rows={2}
        copyable={false}
      />
      <ErrorDisplay error={secretError} title="Invalid secret" />

      {live.result && (
        <div className="status" role="status" aria-live="off">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "2.25rem", fontFamily: "monospace", letterSpacing: "0.1em" }}>{grouped}</span>
            <CopyButton text={code} />
            <span>{live.result.secondsRemaining}s left</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "#8884", margin: "0.5rem 0", overflow: "hidden" }} aria-hidden="true">
            <div style={{ width: `${live.result.fractionRemaining * 100}%`, height: "100%", background: live.result.fractionRemaining < 0.2 ? "#d13438" : "#107c10" }} />
          </div>
          <div style={{ fontFamily: "monospace" }}>
            {live.neighbors.map((n) => (
              <span key={n.offset} style={{ marginRight: "1.5rem", opacity: n.offset === 0 ? 1 : 0.6 }}>
                {n.offset === 0 ? "now" : n.offset < 0 ? "previous" : "next"}: {n.code}
              </span>
            ))}
          </div>
        </div>
      )}

      <h3 style={{ marginTop: "1.5rem" }}>Check a code</h3>
      <div className="toolbar">
        <input
          type="text"
          className="pane-text"
          style={{ width: "12rem" }}
          inputMode="numeric"
          placeholder="Code to check"
          value={checkCode}
          onChange={(e) => {
            setCheckCode(e.target.value);
            setCheckResult(null);
          }}
          spellCheck={false}
        />
        <button type="button" className="btn-small" onClick={runCheck} disabled={!secret.ok || checkCode.trim() === ""}>
          Check
        </button>
        {checkResult && <span role="status">{checkResult}</span>}
      </div>

      <h3 style={{ marginTop: "1.5rem" }}>otpauth:// URI</h3>
      <TextPane
        label="Paste a URI (e.g. the text inside an authenticator QR code) to fill in the secret and settings"
        value={uriText}
        onChange={setUriText}
        placeholder="otpauth://totp/Example:alice@example.com?secret=...&issuer=Example"
        rows={2}
        copyable={false}
        actions={
          <button type="button" className="btn-small" onClick={applyUri} disabled={uriText.trim() === ""}>
            Use this URI
          </button>
        }
      />
      <ErrorDisplay error={uriError} title="Cannot use this URI" />
      <div className="toolbar">
        <label>
          Account{" "}
          <input type="text" className="pane-text" value={label} onChange={(e) => setLabel(e.target.value)} spellCheck={false} placeholder="alice@example.com" />
        </label>
        <label>
          Issuer{" "}
          <input type="text" className="pane-text" value={issuer} onChange={(e) => setIssuer(e.target.value)} spellCheck={false} placeholder="Example" />
        </label>
      </div>
      <TextPane label="URI for the current secret and settings" value={outUri} readOnly rows={2} />
    </div>
  );
}
