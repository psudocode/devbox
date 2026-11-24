import type { ToolCategory, ToolMeta } from "./types";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Registry<T extends ToolMeta> {
  tools: readonly T[];
  get(id: string): T | undefined;
  /** Tools grouped by category, categories in first-seen order, tools sorted by name. */
  byCategory(): { category: ToolCategory; tools: T[] }[];
}

/** Build a registry from a list of tools. Throws on invalid or duplicate ids. */
export function createRegistry<T extends ToolMeta>(tools: readonly T[]): Registry<T> {
  const map = new Map<string, T>();
  for (const tool of tools) {
    if (!ID_PATTERN.test(tool.id)) {
      throw new Error(`Invalid tool id "${tool.id}": use lowercase letters, digits and dashes`);
    }
    if (map.has(tool.id)) {
      throw new Error(`Duplicate tool id "${tool.id}"`);
    }
    map.set(tool.id, tool);
  }

  return {
    tools,
    get: (id) => map.get(id),
    byCategory() {
      const groups = new Map<ToolCategory, T[]>();
      for (const tool of tools) {
        const list = groups.get(tool.category) ?? [];
        list.push(tool);
        groups.set(tool.category, list);
      }
      return [...groups].map(([category, list]) => ({
        category,
        tools: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }));
    },
  };
}
