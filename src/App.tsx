import "./App.css";
import { HomeGrid } from "./components/HomeGrid";
import { Sidebar } from "./components/Sidebar";
import { ToolPage } from "./components/ToolPage";
import { useRoute } from "./lib/useRoute";

function App() {
  const route = useRoute();
  const activeToolId = route.name === "tool" ? route.toolId : null;

  return (
    <div className="layout">
      <Sidebar activeToolId={activeToolId} />
      <main className="content">
        {route.name === "tool" ? <ToolPage key={route.toolId} toolId={route.toolId} /> : <HomeGrid />}
      </main>
    </div>
  );
}

export default App;
