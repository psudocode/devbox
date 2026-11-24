import { useEffect, useRef } from "react";
import { createPipeline } from "./pipeline";

/** App-wide handoff slot (in memory only). */
export const pipeline = createPipeline();

/**
 * Tools that set `acceptsText` call this: when another tool sent text here, `onInput` runs once on mount.
 * Typically `usePipelineInput("base64", (text) => setState((s) => ({ ...s, input: text })))`.
 */
export function usePipelineInput(toolId: string, onInput: (text: string) => void): void {
  const callback = useRef(onInput);
  callback.current = onInput;
  useEffect(() => {
    const value = pipeline.take(toolId);
    if (value !== undefined) callback.current(value);
  }, [toolId]);
}
