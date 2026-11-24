/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorkerPlugin } from "./vite-plugins/service-worker";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, Cloudflare Pages, file server).
  base: "./",
  plugins: [react(), serviceWorkerPlugin()],
  test: {
    // Tool logic is pure (no DOM), so the Node environment is enough and fast.
    environment: "node",
    include: ["src/**/*.test.ts", "vite-plugins/**/*.test.ts"],
  },
});
