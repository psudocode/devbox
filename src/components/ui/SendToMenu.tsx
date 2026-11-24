import { useState } from "react";
import { pipelineTargets } from "../../lib/pipeline";
import { toolHash } from "../../lib/router";
import { pipeline } from "../../lib/usePipeline";
import { registry } from "../../tools/registry";

interface Props {
  /** The tool the text comes from (excluded from the targets). */
  fromToolId: string;
  /** The text to send, usually the tool's output. */
  value: string;
}

/** "Send to..." picker: opens another tool with `value` as its input. Data stays in memory, in this tab. */
export function SendToMenu({ fromToolId, value }: Props) {
  const targets = pipelineTargets(registry.tools, fromToolId);
  const [target, setTarget] = useState("");

  if (targets.length === 0) return null;

  const send = (toolId: string) => {
    if (!toolId) return;
    pipeline.send(toolId, value);
    window.location.hash = toolHash(toolId);
  };

  return (
    <select
      className="btn-small"
      aria-label="Send output to another tool"
      value={target}
      disabled={value === ""}
      onChange={(e) => {
        setTarget(e.target.value);
        send(e.target.value);
      }}
    >
      <option value="">Send to…</option>
      {targets.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.name}
        </option>
      ))}
    </select>
  );
}
