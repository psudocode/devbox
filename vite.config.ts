/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorkerPlugin } from "./vite-plugins/service-worker";
import { vendorChunk } from "./vite-plugins/vendor-chunk";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative base so the static build works from any path (GitHub Pages, Cloudflare Pages, file server).
  base: "./",
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    // Largest chunk is lazy vendor-terser (~507 kB); real limits are enforced by scripts/bundle-budget.mjs.
    chunkSizeWarningLimit: 560,
    rollupOptions: {
      output: { manualChunks: vendorChunk },
    },
  },
  test: {
    // Tool logic is pure (no DOM), so the Node environment is enough and fast.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "vite-plugins/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
