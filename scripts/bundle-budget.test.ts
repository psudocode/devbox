import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { checkBudget, eagerScripts } from "./bundle-budget.mjs";

const budgets = { entry: 100, chunk: 200 };

describe("checkBudget", () => {
  it("passes within budget", () => {
    const r = checkBudget([{ name: "a.js", size: 90 }, { name: "b.js", size: 150 }], ["a.js"], budgets);
    expect(r.errors).toEqual([]);
    expect(r.entrySize).toBe(90);
  });
  it("fails when entry JS is over budget", () => {
    const r = checkBudget([{ name: "a.js", size: 60 }, { name: "c.js", size: 60 }], ["a.js", "c.js"], budgets);
    expect(r.errors).toHaveLength(1);
  });
  it("fails when any chunk is over budget", () => {
    const r = checkBudget([{ name: "big.js", size: 201 }], [], budgets);
    expect(r.errors[0]).toContain("big.js");
  });
});

describe("eagerScripts", () => {
  it("finds script and modulepreload assets", () => {
    const html = '<script type="module" src="./assets/main-1.js"></script><link rel="modulepreload" href="./assets/vendor-react-2.js"><link href="./assets/x.css">';
    expect(eagerScripts(html).sort()).toEqual(["main-1.js", "vendor-react-2.js"]);
  });
});
