import { useEffect, useState } from "react";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import "./App.css";
import { CommandPalette } from "./components/CommandPalette";
import { HomeGrid } from "./components/HomeGrid";
import { Sidebar } from "./components/Sidebar";
import { ToolPage } from "./components/ToolPage";
import { useRoute } from "./lib/useRoute";
import { useTheme } from "./lib/useTheme";
import { markRecent } from "./lib/useUserLists";

/** Hash links would clobber the router, so move focus to <main> by hand. */
function focusMain(e: React.MouseEvent) {
  e.preventDefault();
  document.getElementById("main-content")?.focus();
}

function App() {
  const route = useRoute();
  const activeToolId = route.name === "tool" ? route.toolId : null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { resolved } = useTheme();

  useEffect(() => {
    if (activeToolId) markRecent(activeToolId);
  }, [activeToolId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <FluentProvider theme={resolved === "dark" ? webDarkTheme : webLightTheme}>
      <a className="skip-link" href="#main-content" onClick={focusMain}>
        Skip to main content
      </a>
      <div className="layout">
        <Sidebar activeToolId={activeToolId} onSearch={() => setPaletteOpen(true)} />
        <main className="content" id="main-content" tabIndex={-1}>
          {route.name === "tool" ? <ToolPage key={route.toolId} toolId={route.toolId} /> : <HomeGrid />}
        </main>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </FluentProvider>
  );
}

export default App;
