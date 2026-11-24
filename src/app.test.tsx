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

describe("number base tool", () => {
  const numberInput = () => waitFor(() => container.querySelector<HTMLInputElement>("#number-input"));
  const rowText = (label: string) =>
    [...container.querySelectorAll(".result-row")].find((r) => r.querySelector("dt")?.textContent === label)?.querySelector("code")
      ?.textContent;

  it("converts between bases, including big values", async () => {
    await mount("#/number-base");
    await type(await numberInput(), "255");
    expect(rowText("Binary (2)")).toBe("11111111");
    expect(rowText("Hexadecimal (16)")).toBe("ff");
    expect(rowText("Octal (8)")).toBe("377");
    expect(rowText("Base 36")).toBe("73");

    await type(await numberInput(), "123456789012345678901234567890");
    expect(rowText("Hexadecimal (16)")).toBe("18ee90ff6c373e0ee4e3f0ad2");
  });

  it("switches the input base and shows errors", async () => {
    await mount("#/number-base");
    await act(async () => void (await waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "HEX")))!.click());
    await type(await numberInput(), "0xFF");
    expect(rowText("Decimal (10)")).toBe("255");

    await type(await numberInput(), "xyz");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("is not a valid digit in base 16");
    expect(container.querySelector(".results")).toBeNull();
  });
});

describe("base64 tool", () => {
  it("encodes, swaps and decodes", async () => {
    await mount("#/base64");
    await type(await textarea("Text"), "héllo 🐙");
    expect((await textarea("Base64")).value).toBe("aMOpbGxvIPCfkJk=");

    const swap = await waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Swap"));
    await act(async () => swap.click());
    // after swapping: decode mode, input is the Base64, output is the original text
    expect((await textarea("Base64")).value).toBe("aMOpbGxvIPCfkJk=");
    expect((await textarea("Text")).value).toBe("héllo 🐙");
  });

  it("shows an error for invalid Base64 and for binary data", async () => {
    await mount("#/base64");
    const decode = await waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Decode"));
    await act(async () => decode.click());
    await type(await textarea("Base64"), "###");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid character");
    await type(await textarea("Base64"), "//4=");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("not valid UTF-8");
  });
});

describe("url encode tool", () => {
  it("encodes, switches mode and reports bad escapes", async () => {
    await mount("#/url-encode");
    await type(await textarea("Input"), "a b&c=é");
    expect((await textarea("Output")).value).toBe("a%20b%26c%3D%C3%A9");

    const decode = await waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Decode"));
    await act(async () => decode.click());
    await type(await textarea("Input"), "a%20b%zz");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid percent escape "%zz"');
    await type(await textarea("Input"), "a%20b%26");
    expect((await textarea("Output")).value).toBe("a b&");
  });
});

describe("jwt decoder tool", () => {
  const JWT_IO =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("decodes a token and flags garbage", async () => {
    await mount("#/jwt-decoder");
    await type(await textarea("Token"), `Bearer ${JWT_IO}`);
    expect((await textarea("Header")).value).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect((await textarea("Payload")).value).toContain('"name": "John Doe"');
    expect(container.textContent).toContain("2018-01-18T01:30:22.000Z");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await type(await textarea("Token"), "not-a-jwt");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("3 dot-separated parts");
  });
});

describe("hash generator tool", () => {
  const rowValue = async (name: string) => {
    const row = await waitFor(() =>
      [...container.querySelectorAll(".result-row")].find((r) => r.querySelector("dt")?.textContent?.startsWith(name)),
    );
    return row.querySelector("code")?.textContent;
  };

  it("hashes text with every algorithm and matches a pasted checksum", async () => {
    await mount("#/hash-generator");
    await type(await textarea("Text"), "abc");
    expect(await rowValue("MD5")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(await rowValue("SHA-256")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    const expected = await waitFor(() => container.querySelector<HTMLInputElement>("#expected-hash"));
    await type(expected, "BA7816BF 8F01CFEA 414140DE 5DAE2223 B00361A3 96177A9C B410FF61 F20015AD");
    await waitFor(() => container.textContent?.includes("Matches SHA-256"));
  });

  it("computes HMAC when enabled", async () => {
    await mount("#/hash-generator");
    const toggle = await waitFor(() => [...container.querySelectorAll("label")].find((l) => l.textContent?.trim() === "HMAC"));
    await act(async () => toggle.querySelector("input")!.click());
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#hmac-key")), "Jefe");
    await type(await textarea("Text"), "what do ya want for nothing?");
    // RFC 2202 test case 2
    expect(await rowValue("HMAC-MD5")).toBe("750c783e6ab0b503eaa86e310a5db738");
  });
});

describe("uuid generator tool", () => {
  const output = async () => (await textarea("5 generated")).value.split("\n");

  it("generates ids and regenerates on demand", async () => {
    await mount("#/uuid-generator");
    const first = await output();
    expect(first).toHaveLength(5);
    for (const id of first) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const again = await waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Generate again"));
    await act(async () => again.click());
    expect(await output()).not.toEqual(first);
  });

  it("switches type and validates NanoID options", async () => {
    await mount("#/uuid-generator");
    const select = await waitFor(() => container.querySelector<HTMLSelectElement>(".toolbar select"));
    await act(async () => {
      select.value = "ulid";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    for (const id of await output()) expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);

    await act(async () => {
      select.value = "nanoid";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const alphabet = await waitFor(() => container.querySelector<HTMLInputElement>('input[type="text"]'));
    await type(alphabet, "aa");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("duplicate");
  });
});

describe("unix timestamp tool", () => {
  const rowValue = (label: string) =>
    [...container.querySelectorAll(".result-row")]
      .find((r) => r.querySelector("dt")?.textContent === label)
      ?.querySelector("code")?.textContent;

  it("converts a timestamp in the selected zone and a date back", async () => {
    await mount(`#/unix-timestamp?s=${encodeState({ timestamp: "", unit: "auto", timeZone: "Asia/Jakarta", date: "" })}`);
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#timestamp-input")), "1700000000");
    expect(rowValue("UTC (ISO 8601)")).toBe("2023-11-14T22:13:20.000Z");
    expect(rowValue("Asia/Jakarta (ISO 8601)")).toBe("2023-11-15T05:13:20.000+07:00");

    await type(container.querySelector<HTMLInputElement>("#date-input")!, "2023-11-15 05:13:20");
    const seconds = [...container.querySelectorAll(".result-row")].filter((r) => r.querySelector("dt")?.textContent === "Unix seconds");
    expect(seconds.map((r) => r.querySelector("code")?.textContent)).toEqual(["1700000000", "1700000000"]);
  });

  it("shows errors for bad input", async () => {
    await mount("#/unix-timestamp");
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#timestamp-input")), "abc");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("is a number");
  });
});

describe("regex tester tool", () => {
  it("highlights matches, shows capture groups and previews replacement", async () => {
    await mount("#/regex-tester");
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#regex-pattern")), "(?<year>\\d{4})-(\\d{2})");
    await type(await textarea("Test string"), "dates: 2026-11 and 2027-01");

    await waitFor(() => container.textContent?.includes("2 matches"));
    const marks = [...container.querySelectorAll("mark.regex-match")].map((m) => m.textContent);
    expect(marks).toEqual(["2026-11", "2027-01"]);
    expect(container.textContent).toContain("$1 (year): 2026");
    expect(container.textContent).toContain("$2: 11");

    const replaceBtn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Replace")!;
    await act(async () => replaceBtn.click());
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#regex-replacement")), "$2/$<year>");
    await waitFor(() => (findTextarea("Replaced")?.value ?? "").includes("11/2026"));
    expect(findTextarea("Replaced")?.value).toBe("dates: 11/2026 and 01/2027");
  });

  it("shows an error for an invalid pattern", async () => {
    await mount("#/regex-tester");
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#regex-pattern")), "(");
    await waitFor(() => container.querySelector('[role="alert"]'));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Unterminated group|Unmatched/i);
  });
});

