import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { toolHash } from "../../lib/router";
import { MAX_SHARE_STATE_LENGTH, encodeState } from "../../lib/toolState";

interface Props {
  toolId: string;
  /** The tool state to embed in the link (JSON-serializable). */
  state: unknown;
}

/** Copies a link that reopens this tool with the current state. Everything stays in the URL hash (never sent to a server). */
export function ShareButton({ toolId, state }: Props) {
  const [message, setMessage] = useState<string | null>(null);

  const onClick = async () => {
    const encoded = encodeState(state);
    if (encoded.length > MAX_SHARE_STATE_LENGTH) {
      setMessage("Too much data to share as a link.");
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}${toolHash(toolId, encoded)}`;
    setMessage((await copyText(url)) ? "Link copied!" : "Could not copy link");
    window.setTimeout(() => setMessage(null), 2000);
  };

  return (
    <button type="button" className="btn-small" onClick={onClick}>
      {message ?? "Share link"}
    </button>
  );
}
