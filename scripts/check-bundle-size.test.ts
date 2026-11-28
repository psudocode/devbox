import { describe, it, expect } from "vitest";
import { formatBytes, analyzeBundle, DEFAULT_BUDGETS } from "./check-bundle-size.mjs";

describe("check-bundle-size", () => {
  it("formats bytes into kB correctly", () => {
    expect(formatBytes(1024)).toBe("1.00 kB");
    expect(formatBytes(500 * 1024)).toBe("500.00 kB");
    expect(formatBytes(0)).toBe("0.00 kB");
  });

  it("analyzes real dist directory and passes default budgets", () => {
    const result = analyzeBundle();
    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.initialJsSize).toBeLessThanOrEqual(DEFAULT_BUDGETS.maxInitialJsSize);
    expect(result.initialCssSize).toBeLessThanOrEqual(DEFAULT_BUDGETS.maxInitialCssSize);
    for (const chunk of result.chunks) {
      if (chunk.isJs) {
        expect(chunk.size).toBeLessThanOrEqual(DEFAULT_BUDGETS.maxChunkSize);
      }
    }
  });

  it("detects violations when budgets are set too low", () => {
    const result = analyzeBundle(undefined, {
      maxChunkSize: 50 * 1024, // 50 kB - should fail because largest chunk is > 300 kB
      maxInitialJsSize: 10 * 1024,
      maxInitialCssSize: 5 * 1024,
    });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v: { type: string }) => v.type === "chunk_size")).toBe(true);
    expect(result.violations.some((v: { type: string }) => v.type === "initial_js")).toBe(true);
    expect(result.violations.some((v: { type: string }) => v.type === "initial_css")).toBe(true);
  });

  it("throws when dist directory does not exist", () => {
    expect(() => analyzeBundle("/non/existent/path")).toThrow("Build directory does not exist");
  });
});
