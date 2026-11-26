import { useEffect, useState } from "react";
import { ErrorDisplay, TextPane } from "../../components/ui";
import { usePipelineInput } from "../../lib/usePipeline";
import { decodeInput, formatResult, type DecodeResult } from "./logic";

export const TOOL_ID = "cert-decoder";

export default function CertDecoder() {
  // Not persisted or shareable on purpose: people sometimes paste private keys by mistake.
  const [input, setInput] = useState("");
  usePipelineInput(TOOL_ID, (text) => setInput(text));
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (input.trim() === "") {
      setResult(null);
      return;
    }
    let cancelled = false;
    decodeInput(input).then((r) => {
      if (cancelled) return;
      setNow(Date.now());
      setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [input]);

  const hasPrivateKey = /PRIVATE KEY/.test(input);

  return (
    <div>
      <p className="status">
        Paste a PEM certificate (or a whole chain), a CSR, a public key, or an SSH public key such as <code>id_ed25519.pub</code>. Decoding
        only: signatures and trust chains are <strong>not verified</strong>. Nothing leaves your browser and the input is not saved.
      </p>
      <div className="toolbar">
        <button type="button" className="btn-small" onClick={() => setInput("")} disabled={!input}>
          Clear
        </button>
      </div>
      {hasPrivateKey && (
        <div className="warning" role="note">
          Your input contains a private key. It is not decoded, but do not paste private keys into web pages. Clear this box and, if the key has been
          exposed anywhere, consider it compromised.
        </div>
      )}
      <TextPane
        label="PEM or SSH public key"
        value={input}
        onChange={setInput}
        placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
        rows={10}
      />
      {result && !result.ok && <ErrorDisplay error={result.error} title="Cannot decode this" />}
      {result?.ok && <TextPane label="Decoded" value={formatResult(result.items, now)} rows={22} />}
    </div>
  );
}
