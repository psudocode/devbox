import type { ComponentType } from "react";

export type ToolCategory =
  | "Data & format"
  | "Encode / decode / convert"
  | "Security"
  | "Time"
  | "Web & network"
  | "Frontend & design"
  | "Code & text"
  | "Images"
  | "AWS & backend";

/** Serializable metadata for a tool (no React, safe to use in pure logic and tests). */
export interface ToolMeta {
  /** URL-safe slug, used in the route: `#/<id>`. Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** Extra search terms (used by search / command palette). */
  keywords?: string[];
  /**
   * True when the tool can take plain text as its main input from another tool
   * (the "Send to..." pipeline). The tool must call `usePipelineInput` to receive it.
   */
  acceptsText?: boolean;
}

export interface ToolDefinition extends ToolMeta {
  /** The tool UI. Usually `lazy(() => import("./<id>"))` so each tool is its own chunk. */
  component: ComponentType;
}
