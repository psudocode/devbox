import { useEffect, useMemo, useState } from "react";
import { CopyButton, ErrorDisplay, FileDropZone, SendToMenu, ShareButton, TextPane, ToolbarSwitch } from "../../components/ui";
import { formatBytes } from "../../lib/files";
import { usePipelineInput } from "../../lib/usePipeline";
import { useToolState } from "../../lib/useToolState";
import { extensionForMime, formatOutput, isProbablyText, parseBase64Input, sniffMime, type OutputKind } from "./logic";

export const TOOL_ID = "base64-file";

/** Base64 of a file becomes a very long string in a textarea; keep it comfortable. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Mode = "encode" | "decode";

interface State {
  mode: Mode;
  kind: OutputKind;
  urlSafe: boolean;
  wrap: boolean;
  /** Decode mode: the Base64 / data URI text. */
  input: string;
  filename: string;
}

const DEFAULTS: State = { mode: "encode", kind: "data-uri", urlSafe: false, wrap: false, input: "", filename: "" };

const KINDS: { id: OutputKind; label: string }[] = [
  { id: "data-uri", label: "Data URI" },
  { id: "base64", label: "Plain Base64" },
  { id: "img-tag", label: "<img> tag" },
  { id: "css-url", label: "CSS url()" },
];

interface LoadedFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/** An object URL for `bytes`, revoked when it changes or the component unmounts. Null where object URLs are unavailable. */
function useObjectUrl(bytes: Uint8Array | null, mime: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes || typeof URL.createObjectURL !== "function") {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [bytes, mime]);
  return url;
}

function Preview({ url, mime, bytes }: { url: string | null; mime: string; bytes: Uint8Array }) {
  const textPreview = useMemo(
    () => (isProbablyText(bytes) ? new TextDecoder().decode(bytes.subarray(0, 20_000)) : null),
    [bytes],
  );
  if (url && mime.startsWith("image/")) {
    return (
      <div className="pane">
        <div className="pane-header">Preview</div>
        <div style={{ padding: "0.75rem", border: "1px solid var(--colorNeutralStroke2)", borderRadius: "var(--borderRadiusMedium)", overflow: "auto", textAlign: "center" }}>
          <img src={url} alt="Decoded file preview" style={{ maxWidth: "100%", maxHeight: "24rem" }} />
        </div>
      </div>
    );
  }
  if (url && mime.startsWith("audio/")) {
    return (
      <div className="pane">
        <div className="pane-header">Preview</div>
        <audio controls src={url} style={{ width: "100%" }} />
      </div>
    );
  }
  if (textPreview !== null) {
    return <TextPane label={bytes.length > 20_000 ? "Text preview (first 20,000 characters)" : "Text preview"} value={textPreview} rows={10} />;
  }
  const hex = Array.from(bytes.subarray(0, 64), (b) => b.toString(16).padStart(2, "0")).join(" ");
  return <TextPane label="First bytes (hex)" value={hex} rows={4} />;
}

export default function Base64FileTool() {
  const [state, setState] = useToolState<State>(TOOL_ID, DEFAULTS);
  const update = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }));
  usePipelineInput(TOOL_ID, (text) => update({ mode: "decode", input: text }));

  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const loadFile = async (f: File) => {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sniffed = sniffMime(bytes);
      const declared = f.type && f.type !== "application/octet-stream" ? f.type : "";
      setFile({ name: f.name, bytes, mime: declared || sniffed });
      setFileError(null);
    } catch {
      setFileError(`Could not read "${f.name}".`);
    }
  };

  // ---- encode ----
  const encoded = useMemo(
    () => (file ? formatOutput(file.bytes, file.mime, state.kind, { urlSafe: state.urlSafe, wrap: state.wrap }) : ""),
    [file, state.kind, state.urlSafe, state.wrap],
  );
  const encodeUrl = useObjectUrl(state.mode === "encode" && file ? file.bytes : null, file?.mime ?? "");

  // ---- decode ----
  const parsed = useMemo(() => (state.mode === "decode" && state.input.trim() !== "" ? parseBase64Input(state.input) : null), [state.mode, state.input]);
  const decoded = parsed?.ok ? parsed : null;
  const decodeUrl = useObjectUrl(decoded?.bytes ?? null, decoded?.mime ?? "");
  const decodeError = parsed && !parsed.ok ? parsed.error : null;
  const downloadName = state.filename.trim() || `download.${extensionForMime(decoded?.mime ?? "")}`;

  return (
    <div>
      <div className="toolbar">
        <div role="group" aria-label="Direction" className="segmented">
          {(["encode", "decode"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="btn-small"
              aria-pressed={state.mode === mode}
              onClick={() => update({ mode })}
            >
              {mode === "encode" ? "File → Base64" : "Base64 → File"}
            </button>
          ))}
        </div>
        {state.mode === "encode" ? (
          <>
            <label>
              Output{" "}
              <select value={state.kind} onChange={(e) => update({ kind: e.target.value as OutputKind })}>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <ToolbarSwitch label="URL-safe (- and _)" checked={state.urlSafe} onChange={(urlSafe) => update({ urlSafe })} />
            {state.kind === "base64" && (
              <ToolbarSwitch label="Wrap at 76 characters" checked={state.wrap} onChange={(wrap) => update({ wrap })} />
            )}
            <button type="button" className="btn-small" onClick={() => setFile(null)} disabled={!file}>
              Clear
            </button>
          </>
        ) : (
          <>
            <ShareButton toolId={TOOL_ID} state={{ ...state, filename: "" }} />
            <button type="button" className="btn-small" onClick={() => update({ input: "" })} disabled={!state.input}>
              Clear
            </button>
          </>
        )}
      </div>

      {state.mode === "encode" ? (
        <>
          {!file && (
            <FileDropZone
              onFile={loadFile}
              maxBytes={MAX_FILE_BYTES}
              label="Drop a file or image here, or click to browse (stays in your browser, up to 5 MiB)"
            />
          )}
          <ErrorDisplay error={fileError} title="File error" />
          {file && (
            <>
              <p className="status">
                {file.name} · {file.mime} · {formatBytes(file.bytes.length)} → {formatBytes(Math.ceil(file.bytes.length / 3) * 4)} as Base64
              </p>
              <div className="panes">
                <TextPane
                  label="Result"
                  value={encoded}
                  rows={14}
                  actions={<SendToMenu fromToolId={TOOL_ID} value={encoded} />}
                />
                <Preview url={encodeUrl} mime={file.mime} bytes={file.bytes} />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="panes">
            <TextPane
              label="Base64 or data URI"
              value={state.input}
              rows={14}
              onChange={(input) => update({ input })}
              placeholder="data:image/png;base64,iVBORw0KGgo…  or just the Base64 text"
            />
            {decoded ? (
              <Preview url={decodeUrl} mime={decoded.mime} bytes={decoded.bytes} />
            ) : (
              <div className="pane">
                <div className="pane-header">Preview</div>
                <p className="muted small">Paste Base64 or a data URI to see what it contains and download it as a file.</p>
              </div>
            )}
          </div>
          <ErrorDisplay error={decodeError} title="Cannot decode" />
          {decoded && (
            <>
              <p className="status" aria-live="polite">
                ✓ {decoded.mime} · {formatBytes(decoded.bytes.length)} · {decoded.source === "data-uri" ? "data URI" : "plain Base64"}
              </p>
              {decoded.warnings.map((w) => (
                <p key={w} className="status status-bad">
                  {w}
                </p>
              ))}
              <div className="toolbar">
                <label>
                  File name{" "}
                  <input
                    type="text"
                    className="base-input"
                    style={{ width: "14rem" }}
                    value={state.filename}
                    placeholder={`download.${extensionForMime(decoded.mime)}`}
                    spellCheck={false}
                    onChange={(e) => update({ filename: e.target.value })}
                  />
                </label>
                {decodeUrl && (
                  <a className="btn-small" href={decodeUrl} download={downloadName} style={{ textDecoration: "none" }}>
                    Download {downloadName}
                  </a>
                )}
                <CopyButton
                  text={formatOutput(decoded.bytes, decoded.mime, "data-uri", { urlSafe: false, wrap: false })}
                  label="Copy as data URI"
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
