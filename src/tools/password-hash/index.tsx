import { useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, ShareButton } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import {
  DEFAULT_ARGON2,
  DEFAULT_BCRYPT,
  hashPassword,
  inspectHash,
  verifyPasswordHash,
  type HashResult,
  type PasswordHashAlgorithm,
  type VerifyResult,
} from "./logic";

export const TOOL_ID = "password-hash";

interface State {
  algorithm: PasswordHashAlgorithm;
  costFactor: number;
  memorySize: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

const DEFAULTS: State = {
  algorithm: "argon2id",
  costFactor: DEFAULT_BCRYPT.costFactor,
  memorySize: DEFAULT_ARGON2.memorySize,
  iterations: DEFAULT_ARGON2.iterations,
  parallelism: DEFAULT_ARGON2.parallelism,
  hashLength: DEFAULT_ARGON2.hashLength,
};

export default function PasswordHash() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));

  // Passwords and hashes stay in memory only (not persisted to localStorage or URL hash).
  const [password, setPassword] = useState("");
  const [hashRes, setHashRes] = useState<HashResult | null>(null);
  const [hashing, setHashing] = useState(false);

  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyHash, setVerifyHash] = useState("");
  const [verifyRes, setVerifyRes] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  usePipelineInput(TOOL_ID, (text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("$2") || trimmed.startsWith("$argon2")) {
      setVerifyHash(trimmed);
    } else {
      setPassword(text);
    }
  });

  const inspected = useMemo(() => inspectHash(verifyHash), [verifyHash]);

  const runHash = async () => {
    setHashing(true);
    try {
      const res =
        state.algorithm === "bcrypt"
          ? await hashPassword(password, { algorithm: "bcrypt", costFactor: state.costFactor })
          : await hashPassword(password, {
              algorithm: state.algorithm,
              memorySize: state.memorySize,
              iterations: state.iterations,
              parallelism: state.parallelism,
              hashLength: state.hashLength,
            });
      setHashRes(res);
      if (res.ok && !verifyHash) {
        setVerifyHash(res.hash);
      }
    } finally {
      setHashing(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    try {
      setVerifyRes(await verifyPasswordHash(verifyPassword, verifyHash));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <label>
          Algorithm{" "}
          <select value={state.algorithm} onChange={(e) => update({ algorithm: e.target.value as PasswordHashAlgorithm })}>
            <option value="argon2id">Argon2id (recommended)</option>
            <option value="argon2i">Argon2i</option>
            <option value="argon2d">Argon2d</option>
            <option value="bcrypt">bcrypt</option>
          </select>
        </label>

        {state.algorithm === "bcrypt" ? (
          <label>
            Cost factor (4–16){" "}
            <input
              type="number"
              min={4}
              max={16}
              value={state.costFactor}
              onChange={(e) => update({ costFactor: Number(e.target.value) })}
              style={{ width: "4.5rem" }}
            />
          </label>
        ) : (
          <>
            <label>
              Memory (KiB){" "}
              <select value={state.memorySize} onChange={(e) => update({ memorySize: Number(e.target.value) })}>
                <option value={4096}>4096 (4 MiB)</option>
                <option value={19456}>19456 (19 MiB)</option>
                <option value={65536}>65536 (64 MiB)</option>
              </select>
            </label>
            <label>
              Iterations{" "}
              <input
                type="number"
                min={1}
                max={20}
                value={state.iterations}
                onChange={(e) => update({ iterations: Number(e.target.value) })}
                style={{ width: "4rem" }}
              />
            </label>
            <label>
              Parallelism{" "}
              <input
                type="number"
                min={1}
                max={8}
                value={state.parallelism}
                onChange={(e) => update({ parallelism: Number(e.target.value) })}
                style={{ width: "4rem" }}
              />
            </label>
            <label>
              Length (bytes){" "}
              <input
                type="number"
                min={16}
                max={64}
                value={state.hashLength}
                onChange={(e) => update({ hashLength: Number(e.target.value) })}
                style={{ width: "4rem" }}
              />
            </label>
          </>
        )}

        <ShareButton toolId={TOOL_ID} state={state} />
      </div>

      <h2 className="section-title">Hash password (WASM, client-side)</h2>
      <div className="toolbar">
        <div className="pane" style={{ flex: 1, minWidth: "16rem" }}>
          <div className="pane-header">
            <label htmlFor="ph-password">Password (never stored)</label>
          </div>
          <input
            id="ph-password"
            className="pane-text"
            type="password"
            value={password}
            placeholder="Enter password…"
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runHash();
            }}
          />
        </div>
        <button type="button" className="btn-small" onClick={() => void runHash()} disabled={hashing}>
          {hashing ? "Hashing…" : "Generate hash"}
        </button>
      </div>

      {hashRes && !hashRes.ok && <ErrorDisplay error={hashRes.error} title="Cannot hash password" />}
      {hashRes?.ok && (
        <>
          {hashRes.warning && <p className="status">{hashRes.warning}</p>}
          <dl className="results">
            <div className="result-row">
              <dt>
                Encoded hash
                <div className="muted small">
                  {hashRes.algorithm} · {hashRes.durationMs} ms
                </div>
              </dt>
              <dd>
                <code>{hashRes.hash}</code>
                <CopyButton text={hashRes.hash} />
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => {
                    setVerifyHash(hashRes.hash);
                    setVerifyRes(null);
                  }}
                >
                  Use in verify
                </button>
              </dd>
            </div>
          </dl>
        </>
      )}

      <h2 className="section-title">Verify & inspect hash</h2>
      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="pane" style={{ flex: 1, minWidth: "14rem" }}>
          <div className="pane-header">
            <label htmlFor="ph-verify-pw">Password</label>
          </div>
          <input
            id="ph-verify-pw"
            className="pane-text"
            type="password"
            value={verifyPassword}
            placeholder="Password to check…"
            autoComplete="off"
            onChange={(e) => setVerifyPassword(e.target.value)}
          />
        </div>
        <div className="pane" style={{ flex: 2, minWidth: "18rem" }}>
          <div className="pane-header">
            <label htmlFor="ph-verify-hash">Encoded hash ($2a$/$2b$/$2y$ or $argon2id$)</label>
          </div>
          <input
            id="ph-verify-hash"
            className="pane-text"
            type="text"
            value={verifyHash}
            placeholder="$argon2id$v=19$m=19456,t=2,p=1$..."
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setVerifyHash(e.target.value)}
          />
        </div>
        <button type="button" className="btn-small" onClick={() => void runVerify()} disabled={verifying}>
          {verifying ? "Verifying…" : "Verify"}
        </button>
      </div>

      {verifyRes && !verifyRes.ok && <ErrorDisplay error={verifyRes.error} title="Cannot verify" />}
      {verifyRes?.ok && (
        <p className="status">
          <strong>{verifyRes.valid ? "Match: password is valid" : "No match: password does not match hash"}</strong> ({verifyRes.algorithm})
        </p>
      )}

      {inspected && (
        <dl className="results">
          <div className="result-row">
            <dt>Detected format</dt>
            <dd>
              <code>{inspected.algorithm}</code>
            </dd>
          </div>
          {inspected.details.map((d) => (
            <div key={d.label} className="result-row">
              <dt>{d.label}</dt>
              <dd>
                <code>{d.value}</code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
