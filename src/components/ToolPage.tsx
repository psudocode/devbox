import { Suspense } from "react";
import { Body1, Link, Spinner, Title2 } from "@fluentui/react-components";
import { HOME_HASH } from "../lib/router";
import { registry } from "../tools/registry";
import { FavoriteButton } from "./FavoriteButton";

export function ToolPage({ toolId }: { toolId: string }) {
  const tool = registry.get(toolId);

  if (!tool) {
    return (
      <div className="tool-page">
        <Title2 as="h1" block>
          Tool not found
        </Title2>
        <Body1 as="p">
          There is no tool called <code>{toolId}</code>. <Link href={HOME_HASH}>Back to all tools</Link>.
        </Body1>
      </div>
    );
  }

  const Tool = tool.component;
  return (
    <div className="tool-page">
      <header className="tool-page-header">
        <div>
          <Title2 as="h1" block>
            {tool.name}
          </Title2>
          <Body1 as="p" className="muted">
            {tool.description}
          </Body1>
        </div>
        <FavoriteButton toolId={tool.id} />
      </header>
      <Suspense fallback={<Spinner size="small" label="Loading…" />}>
        <Tool />
      </Suspense>
    </div>
  );
}
