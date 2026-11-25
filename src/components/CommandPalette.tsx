import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";
import { moveSelection, searchTools } from "../lib/search";
import { toolHash } from "../lib/router";
import { registry } from "../tools/registry";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchTools(registry.tools, query), [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const go = (index: number) => {
    const tool = results[index];
    if (!tool) return;
    window.location.hash = toolHash(tool.id);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => moveSelection(s, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => moveSelection(s, -1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-search-row">
          <Search20Regular />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder="Search tools…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            aria-controls="palette-results"
            aria-activedescendant={results[selected] ? `palette-item-${results[selected].id}` : undefined}
          />
        </div>
        <ul id="palette-results" className="palette-results" role="listbox">
          {results.length === 0 && <li className="palette-empty muted">No tools found</li>}
          {results.map((tool, i) => (
            <li
              key={tool.id}
              id={`palette-item-${tool.id}`}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "palette-item active" : "palette-item"}
              onMouseEnter={() => setSelected(i)}
              onClick={() => go(i)}
            >
              <div className="palette-item-top">
                <strong>{tool.name}</strong>
                <Badge appearance="tint" size="small">
                  {tool.category}
                </Badge>
              </div>
              <span className="muted small">{tool.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
