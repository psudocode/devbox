import { useEffect, useState } from "react";
import { CopyButton, ErrorDisplay, FileDropZone, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { formatBytes } from "../../lib/files";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { findMatch, hashAll, utf8, type HashRow, type OutputFormat } from "./logic";

export const TOOL_ID = "hash-generator";

const MAX_FILE_BYTES = 200 * 1024 * 1024;

interface State {
  input: string;
  format: OutputFormat;
  useHmac: boolean;
  key: string;
  expected: string;
}

const DEFAULTS: State = { input: "", format: "hex", useHmac: false, key: "", expected: "" };

interface FileInput {
  name: string;
  bytes: Uint8Array;
}

export default function HashGenerator() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ input: text }));

  // A dropped file is kept in memory only (never persisted or shared).
  const [file, setFile] = useState<FileInput | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rows, setRows] = useState<HashRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const data = file ? file.bytes : utf8(state.input);
  const hasInput = file !== null || state.input !== "";

  useEffect(() => {
    let cancelled = false;
    if (!hasInput) {
      setRows([]);
      setError(null);
      return;
    }
    hashAll(data, state.format, state.useHmac ? utf8(state.key) : undefined).then(
      (result) => {
        if (!cancelled) {
          setRows(result);
          setError(null);
        }
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Hashing failed");
      },
    );
    return () => {
      cancelled = true;
    };
    // `data` is derived from file / state.input, listed through them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, state.input, state.format, state.useHmac, state.key, hasInput]);

  const matched = findMatch(rows, state.expected);

  const loadFile = async (f: File) => {
    try {
      setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      setFileError(null);
    } catch {
      setFileError(`Could not read "${f.name}".`);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <label>
          Output{" "}
          <select value={state.format} onChange={(e) => update({ format: e.target.value as OutputFormat })}>
            <option value="hex">hex (lowercase)</option>
            <option value="HEX">HEX (uppercase)</option>
            <option value="base64">Base64</option>
          </select>
        </label>
        <ToolbarSwitch
          label="HMAC"
          checked={state.useHmac}
          onChange={(useHmac) => update({ useHmac })}
        />
        {!file && (
          <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
            Clear
          </button>
        )}
        <ShareButton toolId={TOOL_ID} state={{ ...state, key: "" }} />
      </div>

      {state.useHmac && (
        <div className="pane" style={{ marginBottom: "0.75rem" }}>
          <div className="pane-header">
            <label htmlFor="hmac-key">HMAC secret key (UTF-8 text)</label>
          </div>
          <input
            id="hmac-key"
            className="pane-text"
            type="text"
            value={state.key}
            autoComplete="off"
            spellCheck={false}
            placeholder="secret"
            onChange={(e) => update({ key: e.target.value })}
          />
          <span className="muted small">The key is saved in this browser like other inputs, but never included in share links.</span>
        </div>
      )}

      {file ? (
        <p className="status">
          File: <strong>{file.name}</strong> ({formatBytes(file.bytes.length)}){" "}
          <button type="button" className="btn-small" onClick={() => setFile(null)}>
            Use text instead
          </button>
        </p>
      ) : (
        <TextPane label="Text" value={state.input} onChange={(input) => update({ input })} placeholder="Text to hash (UTF-8)" rows={6} />
      )}

      {!file && (
        <div style={{ marginTop: "0.75rem" }}>
          <FileDropZone onFile={loadFile} maxBytes={MAX_FILE_BYTES} label="…or drop a file to hash it (stays in your browser)" />
        </div>
      )}
      <ErrorDisplay error={fileError} title="File error" />
      <ErrorDisplay error={error} title="Hashing failed" />

      {rows.length > 0 && (
        <>
          <dl className="results">
            {rows.map((row) => (
              <div key={row.algorithm} className="result-row">
                <dt>
                  {state.useHmac ? "HMAC-" : ""}
                  {row.algorithm}
                  {matched === row.algorithm && <span className="match-badge"> ✓ match</span>}
                </dt>
                <dd>
                  <code>{row.value}</code>
                  <CopyButton text={row.value} />
                </dd>
              </div>
            ))}
          </dl>

          <div className="pane" style={{ marginTop: "1rem" }}>
            <div className="pane-header">
              <label htmlFor="expected-hash">Compare with a known hash</label>
              {state.expected.trim() !== "" && (
                <span className={matched ? "token-valid" : "token-expired"}>
                  {matched ? `Matches ${matched}` : "No match"}
                </span>
              )}
            </div>
            <input
              id="expected-hash"
              className="pane-text"
              type="text"
              value={state.expected}
              placeholder="Paste a checksum to verify"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => update({ expected: e.target.value })}
            />
          </div>
        </>
      )}
      <p className="muted small" style={{ marginTop: "1rem" }}>
        MD5 and SHA-1 are broken for security purposes; use them only for checksums and compatibility.
      </p>
    </div>
  );
}
