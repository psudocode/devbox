import { useMemo } from "react";
import { ErrorDisplay, ShareButton, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { decodeJwt, formatRelative, timeStatus, type TokenTimeStatus } from "./logic";

export const TOOL_ID = "jwt-decoder";

interface State {
  input: string;
}

const DEFAULTS: State = { input: "" };

const STATUS_TEXT: Record<TokenTimeStatus, string> = {
  expired: "Expired",
  "not-yet-valid": "Not valid yet",
  valid: "Not expired",
  "no-expiry": "No expiry claim",
};

export default function JwtDecoder() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  usePipelineInput(TOOL_ID, (text) => setState({ input: text }));

  const result = useMemo(() => (state.input.trim() === "" ? null : decodeJwt(state.input)), [state.input]);
  // "now" is read when the token changes: good enough for a decoder, no ticking timer needed.
  const now = useMemo(() => Date.now(), [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const jwt = result?.ok ? result.jwt : null;
  const status = jwt ? timeStatus(jwt.timeClaims, now) : null;

  return (
    <div>
      <p className="status">
        Decoding only: the signature is <strong>not verified</strong>. Everything stays in your browser, but avoid pasting
        production tokens into tools you do not trust.
      </p>
      <div className="toolbar">
        <ShareButton toolId={TOOL_ID} state={state} />
        <button type="button" className="btn-small" onClick={() => setState({ input: "" })} disabled={!state.input}>
          Clear
        </button>
      </div>

      <TextPane
        label="Token"
        value={state.input}
        onChange={(input) => setState({ input })}
        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        rows={6}
      />
      {result && !result.ok && <ErrorDisplay error={result.error} title="Not a valid JWT" />}

      {jwt && (
        <>
          <p className="status" aria-live="polite">
            Algorithm: <code>{jwt.algorithm ?? "unknown"}</code> · <span className={`token-status token-${status}`}>{status && STATUS_TEXT[status]}</span>
          </p>

          {jwt.warnings.map((warning) => (
            <div key={warning} className="warning" role="note">
              {warning}
            </div>
          ))}

          <div className="panes">
            <TextPane label="Header" value={jwt.header.pretty} rows={8} />
            <TextPane label="Payload" value={jwt.payload.pretty} rows={8} />
          </div>

          {jwt.timeClaims.length > 0 && (
            <dl className="results">
              {jwt.timeClaims.map((claim) => (
                <div key={claim.name} className="result-row">
                  <dt>
                    {claim.label} (<code>{claim.name}</code>)
                  </dt>
                  <dd>
                    <code>{claim.iso}</code>
                    <span className="muted small">{formatRelative(claim.seconds, now)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="result-row" style={{ marginTop: "1rem" }}>
            <dt>Signature</dt>
            <dd>
              <code>{jwt.signature || "(empty)"}</code>
              {jwt.signatureBytes > 0 && <span className="muted small">{jwt.signatureBytes} bytes</span>}
            </dd>
          </div>
        </>
      )}
    </div>
  );
}
