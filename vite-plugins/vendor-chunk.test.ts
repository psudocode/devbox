import { describe, expect, it } from "vitest";
import { vendorChunk } from "./vendor-chunk";

describe("vendorChunk", () => {
  it("groups Fluent UI and its runtime deps", () => {
    expect(vendorChunk("/p/node_modules/@fluentui/react-button/lib/index.js")).toBe("vendor-fluent");
    expect(vendorChunk("/p/node_modules/@griffel/core/index.js")).toBe("vendor-fluent");
  });
  it("keeps icons in their own chunk", () => {
    expect(vendorChunk("/p/node_modules/@fluentui/react-icons/lib/index.js")).toBe("vendor-fluent-icons");
  });
  it("isolates terser (lazy JS minifier)", () => {
    expect(vendorChunk("/p/node_modules/terser/lib/parse.js")).toBe("vendor-terser");
  });
  it("groups React", () => {
    expect(vendorChunk("/p/node_modules/react-dom/index.js")).toBe("vendor-react");
  });
  it("leaves app code and other deps to Rollup", () => {
    expect(vendorChunk("/p/src/App.tsx")).toBeUndefined();
    expect(vendorChunk("/p/node_modules/marked/lib/marked.js")).toBeUndefined();
  });
});
