import { Body1, Subtitle1, Title1 } from "@fluentui/react-components";
import { toolHash } from "../lib/router";
import { useFavorites, useRecent } from "../lib/useUserLists";
import { registry } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";

function ToolCard({ tool }: { tool: ToolDefinition }) {
  return (
    <a className="card" href={toolHash(tool.id)}>
      <strong>{tool.name}</strong>
      <span className="muted small">{tool.description}</span>
    </a>
  );
}

export function HomeGrid() {
  const groups = registry.byCategory();
  const { favorites } = useFavorites();
  const recent = useRecent();
  const quickLists = [
    { title: "Favorites", ids: favorites },
    { title: "Recently used", ids: recent },
  ];
  return (
    <div className="home">
      <header className="home-header">
        <Title1 as="h1" block>
          DevBox
        </Title1>
        <Body1 as="p" className="muted">
          Small developer tools in one place. Runs entirely in your browser, no server.
        </Body1>
      </header>
      {groups.length === 0 && <p className="muted">Tools coming soon.</p>}
      {quickLists.map(
        (list) =>
          list.ids.length > 0 && (
            <section key={list.title} className="home-group">
              <Subtitle1 as="h2" block>
                {list.title}
              </Subtitle1>
              <div className="grid">
                {list.ids.map((id) => {
                  const tool = registry.get(id);
                  return tool && <ToolCard key={id} tool={tool} />;
                })}
              </div>
            </section>
          ),
      )}
      {groups.map((group) => (
        <section key={group.category} className="home-group">
          <Subtitle1 as="h2" block>
            {group.category}
          </Subtitle1>
          <div className="grid">
            {group.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
