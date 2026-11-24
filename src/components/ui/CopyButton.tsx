import { useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";

interface Props {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = "Copy" }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1500);
  };

  return (
    <button type="button" className="btn-small" onClick={onClick} disabled={text === ""}>
      {state === "copied" ? "Copied!" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
