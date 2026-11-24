import { Suspense } from "react";
import { HOME_HASH } from "../lib/router";
import { registry } from "../tools/registry";
import { FavoriteButton } from "./FavoriteButton";

export function ToolPage({ toolId }: { toolId: string }) {
  const tool = registry.get(toolId);

  if (!tool) {
    return (
      <div className="tool-page">
        <h1>Tool not found</h1>
        <p>
          There is no tool called <code>{toolId}</code>. <a href={HOME_HASH}>Back to all tools</a>.
        </p>
      </div>
    );
  }

  const Tool = tool.component;
  return (
    <div className="tool-page">
      <header>
        <h1>{tool.name}</h1>
        <p className="muted">{tool.description}</p>
        <FavoriteButton toolId={tool.id} />
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Tool />
      </Suspense>
    </div>
  );
}
