import { lazy } from "react";
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
export const toolDefinitions: ToolDefinition[] = [
  {
    id: "json-formatter",
    name: "JSON Formatter",
    description: "Prettify, minify, validate and sort keys. Keeps big numbers exact.",
    category: "Data & format",
    keywords: ["json", "prettify", "beautify", "minify", "validate", "sort", "lint"],
    acceptsText: true,
    component: lazy(() => import("./json-formatter")),
  },
];

export const registry = createRegistry(toolDefinitions);
