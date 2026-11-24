import { useEffect, useState } from "react";
import "./App.css";
import { CommandPalette } from "./components/CommandPalette";
import { HomeGrid } from "./components/HomeGrid";
import { Sidebar } from "./components/Sidebar";
import { ToolPage } from "./components/ToolPage";
import { useRoute } from "./lib/useRoute";

function App() {
  const route = useRoute();
  const activeToolId = route.name === "tool" ? route.toolId : null;
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    <div className="layout">
      <Sidebar activeToolId={activeToolId} onSearch={() => setPaletteOpen(true)} />
      <main className="content">
        {route.name === "tool" ? <ToolPage key={route.toolId} toolId={route.toolId} /> : <HomeGrid />}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default App;
