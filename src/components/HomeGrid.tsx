import { toolHash } from "../lib/router";
import { registry } from "../tools/registry";

export function HomeGrid() {
  const groups = registry.byCategory();
  return (
    <div className="home">
      <h1>DevBox</h1>
      <p>Small developer tools in one place. Runs entirely in your browser, no server.</p>
      {groups.length === 0 && <p className="muted">Tools coming soon.</p>}
      {groups.map((group) => (
        <section key={group.category} className="home-group">
          <h2>{group.category}</h2>
          <div className="grid">
            {group.tools.map((tool) => (
              <a key={tool.id} className="card" href={toolHash(tool.id)}>
                <strong>{tool.name}</strong>
                <span className="muted small">{tool.description}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
