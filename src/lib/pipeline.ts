import type { ToolMeta } from "../tools/types";

/** Tools that can receive text from `fromToolId`, sorted by name. */
export function pipelineTargets<T extends ToolMeta>(tools: readonly T[], fromToolId: string): T[] {
  return tools
    .filter((tool) => tool.acceptsText && tool.id !== fromToolId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Pipeline {
  /** Leave `value` for `toolId`. Replaces any earlier pending value. */
  send(toolId: string, value: string): void;
  /** Take the pending value if it is addressed to `toolId`. Returns it once, then clears it. */
  take(toolId: string): string | undefined;
}

/** One-slot, in-memory handoff between tools. Nothing is persisted, so data never outlives the page. */
export function createPipeline(): Pipeline {
  let pending: { toolId: string; value: string } | undefined;
  return {
    send(toolId, value) {
      pending = { toolId, value };
    },
    take(toolId) {
      if (!pending || pending.toolId !== toolId) return undefined;
      const { value } = pending;
      pending = undefined;
      return value;
    },
  };
}
