/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorkerPlugin } from "./vite-plugins/service-worker";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, Cloudflare Pages, file server).
  base: "./",
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@fluentui") || id.includes("@griffel")) {
            return "fluentui";
          }
          if (
            id.includes("node_modules/terser/lib/ast") ||
            id.includes("node_modules/terser/lib/parse")
          ) {
            return "terser-parser";
          }
        },
      },
    },
  },
  test: {
    // Tool logic is pure (no DOM), so the Node environment is enough and fast.
    environment: "node",
    testTimeout: 10000,
    include: [
      "src/**/*.test.{ts,tsx}",
      "vite-plugins/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
