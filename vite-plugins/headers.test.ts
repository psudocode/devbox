import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

function directives(): Map<string, string[]> {
  const line = text.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
  if (!line) throw new Error("CSP header missing");
  const policy = line.split("Content-Security-Policy:")[1];
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([name, ...values]) => [name, values]),
  );
}

describe("public/_headers security policy", () => {
  it("blocks all outbound connections so 'no data leaves the browser' is enforced", () => {
    const csp = directives();
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'none'"]);
  });

  it("allows WebAssembly (hash-wasm) but never eval", () => {
    const scripts = directives().get("script-src") ?? [];
    expect(scripts).toContain("'wasm-unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it("sets the companion hardening headers", () => {
    expect(text).toMatch(/X-Content-Type-Options: nosniff/);
    expect(text).toMatch(/Referrer-Policy: no-referrer/);
    expect(text).toMatch(/Permissions-Policy: .*camera=\(\)/);
  });
});
