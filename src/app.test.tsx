// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { encodeState } from "./lib/toolState";

// UI smoke tests: render the real app in jsdom and drive it like a user.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const flush = (ms = 30) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

/** Wait (up to ~2s) until `check` stops returning null/undefined/false, flushing React work in between. */
async function waitFor<T>(check: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = check();
    if (value) return value;
    await flush(20);
  }
  throw new Error("waitFor timed out");
}

async function mount(hash = "") {
  window.location.hash = hash;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
  await flush();
}

async function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const findTextarea = (label: string) =>
  [...container.querySelectorAll("textarea")].find(
    (t) => container.querySelector(`label[for="${t.id}"]`)?.textContent === label,
  ) as HTMLTextAreaElement | undefined;

/** The tool is lazy-loaded, so wait for it to show up. */
const textarea = (label: string) => waitFor(() => findTextarea(label));

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("app shell", () => {
  it("shows the home page with registered tools", async () => {
    await mount("");
    expect(container.querySelector("h1")?.textContent).toBe("DevBox");
    const links = [...container.querySelectorAll(".home a.card")].map((a) => a.getAttribute("href"));
    expect(links).toContain("#/json-formatter");
  });

  it("shows a not-found page for unknown tools", async () => {
    await mount("#/nope");
    expect(container.textContent).toContain("Tool not found");
  });

  it("opens the command palette with Ctrl+K and navigates on Enter", async () => {
    await mount("");
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    await type(container.querySelector(".palette-input") as HTMLInputElement, "json format");
    expect(container.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);

    await act(async () => {
      container
        .querySelector(".palette")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(window.location.hash).toBe("#/json-formatter");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("json formatter tool", () => {
  it("prettifies input", async () => {
    await mount("#/json-formatter");
    await type(await textarea("Input"), '{"b":1,"a":[1,2]}');
    expect((await textarea("Output")).value).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(container.querySelector(".status")?.textContent).toContain("Valid JSON");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an error with position for invalid JSON", async () => {
    await mount("#/json-formatter");
    await type(await textarea("Input"), '{"a": }');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/line 1, column 7/);
    expect((await textarea("Output")).value).toBe("");
  });

  it("restores shared state from the URL hash", async () => {
    const state = { input: '{"z":1,"y":2}', mode: "minify", indent: "2", sortKeys: true };
    await mount(`#/json-formatter?s=${encodeState(state)}`);
    expect((await textarea("Input")).value).toBe('{"z":1,"y":2}');
    expect((await textarea("Output")).value).toBe('{"y":2,"z":1}');
  });

  it("persists the last input across mounts", async () => {
    await mount("#/json-formatter");
    await type(await textarea("Input"), "[1,2,3]");
    await flush(400); // debounced save
    await act(async () => root.unmount());
    container.remove();

    await mount("#/json-formatter");
    expect((await textarea("Input")).value).toBe("[1,2,3]");
  });

  it("marks a tool as favorite and lists it in the sidebar", async () => {
    await mount("#/json-formatter");
    const button = await waitFor(() => container.querySelector<HTMLButtonElement>("button.favorite"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => button.click());
    expect(button.getAttribute("aria-pressed")).toBe("true");
    const headings = [...container.querySelectorAll(".sidebar-heading")].map((h) => h.textContent);
    expect(headings).toContain("Favorites");
    expect(localStorage.getItem("devbox:favorites")).toBe('["json-formatter"]');
  });
});

describe("json compare tool", () => {
  it("lists differences and reports identical documents", async () => {
    await mount("#/json-diff");
    await type(await textarea("Left"), '{"a":1,"b":[1,2],"c":true}');
    await type(await textarea("Right"), '{"b":[1,3],"a":1.0,"d":null}');

    const items = [...container.querySelectorAll(".diff-item")].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items.join("|")).toContain("$.b[1]");
    expect(container.querySelector(".status")?.textContent).toContain("3 differences: 1 added, 1 removed, 1 changed");

    await type(await textarea("Right"), '{"c":true,"b":[1,2],"a":1}');
    expect(container.querySelector(".status")?.textContent).toContain("Identical");
    expect(container.querySelector(".diff-list")).toBeNull();
  });

  it("names the invalid side", async () => {
    await mount("#/json-diff");
    await type(await textarea("Left"), "{}");
    await type(await textarea("Right"), "{oops}");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid JSON (right)");
  });
});

