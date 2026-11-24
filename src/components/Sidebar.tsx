import { HOME_HASH, toolHash } from "../lib/router";
import { ThemeToggle } from "./ThemeToggle";
import { useFavorites, useRecent } from "../lib/useUserLists";
import { registry } from "../tools/registry";

export function Sidebar({
  activeToolId,
  onSearch,
}: {
  activeToolId: string | null;
  onSearch: () => void;
}) {
  const groups = registry.byCategory();
  const { favorites } = useFavorites();
  const recent = useRecent().slice(0, 5);
  const quickLists = [
    { title: "Favorites", ids: favorites },
    { title: "Recent", ids: recent },
  ];
  return (
    <nav className="sidebar" aria-label="Tools">
      <a className="sidebar-brand" href={HOME_HASH}>
        DevBox
      </a>
      <button type="button" className="sidebar-search" onClick={onSearch}>
        Search tools… <kbd>Ctrl K</kbd>
      </button>
      {quickLists.map(
        (list) =>
          list.ids.length > 0 && (
            <section key={list.title}>
              <h2 className="sidebar-heading">{list.title}</h2>
              <ul>
                {list.ids.map((id) => (
                  <li key={id}>
                    <a href={toolHash(id)}>{registry.get(id)?.name}</a>
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {groups.length === 0 && <p className="muted small">No tools yet.</p>}
      {groups.map((group) => (
        <section key={group.category}>
          <h2 className="sidebar-heading">{group.category}</h2>
          <ul>
            {group.tools.map((tool) => (
              <li key={tool.id}>
                <a
                  href={toolHash(tool.id)}
                  aria-current={tool.id === activeToolId ? "page" : undefined}
                >
                  {tool.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ThemeToggle />
    </nav>
  );
}
