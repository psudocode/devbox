import { createRegistry } from "./registry-core";
import type { ToolDefinition } from "./types";

/**
 * Register new tools here. Each tool lives in `src/tools/<tool-id>/` and is lazy-loaded:
 *
 *   {
 *     id: "json-formatter",
 *     name: "JSON Formatter",
 *     description: "Prettify, minify and validate JSON",
 *     category: "Data & format",
 *     keywords: ["json", "prettify"],
 *     component: lazy(() => import("./json-formatter")),
 *   },
 */
export const toolDefinitions: ToolDefinition[] = [];

export const registry = createRegistry(toolDefinitions);
