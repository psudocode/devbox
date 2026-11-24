import { describe, expect, it } from "vitest";

// Smoke test: proves the test runner works and that the Web APIs the tools rely on exist.
describe("test environment", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("exposes Web APIs used by tools", async () => {
    expect(typeof TextEncoder).toBe("function");
    expect(typeof URL).toBe("function");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("devbox"));
    expect(digest.byteLength).toBe(32);
  });
});
