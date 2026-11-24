import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, Cloudflare Pages, file server).
  base: "./",
  plugins: [react()],
});
