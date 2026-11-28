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
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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

  it("offers a skip link that moves focus to the main landmark", async () => {
    await mount("");
    const skip = container.querySelector<HTMLAnchorElement>("a.skip-link")!;
    expect(skip.textContent).toBe("Skip to main content");
    await act(async () => skip.click());
    expect(document.activeElement).toBe(container.querySelector("main#main-content"));
    expect(window.location.hash).toBe("");
  });

  it("labels the palette search box and keeps focus inside it on Tab", async () => {
    await mount("");
    await act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })));
    const input = container.querySelector<HTMLInputElement>(".palette-input")!;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-label")).toBe("Search tools");
    expect(document.activeElement).toBe(input);

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => void input.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("cycles theme and updates FluentProvider + document theme", async () => {
    await mount("");
    const toggle = container.querySelector<HTMLButtonElement>("button.theme-toggle")!;
    const provider = container.querySelector<HTMLElement>(".fui-FluentProvider")!;
    const initialBg = getComputedStyle(provider).getPropertyValue("--colorNeutralBackground1");
    expect(document.documentElement.dataset.theme).toBe("light");

    // system -> light -> dark
    await act(async () => toggle.click());
    expect(toggle.textContent).toContain("Light");
    await act(async () => toggle.click());
    expect(toggle.textContent).toContain("Dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getComputedStyle(provider).getPropertyValue("--colorNeutralBackground1")).not.toBe(initialBg);
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
    const toggle = await waitFor(() => container.querySelector<HTMLInputElement>('input[role="switch"]'));
    await act(async () => toggle.click());
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

describe("color converter tool", () => {
  it("converts HEX/RGB/HSL/OKLCH and checks WCAG contrast", async () => {
    await mount("#/color-converter");
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#color-input")), "rgb(255, 0, 0)");
    const rows = [...container.querySelectorAll(".result-row")].map((r) => [
      r.querySelector("dt")?.textContent,
      r.querySelector("code")?.textContent,
    ]);
    expect(rows).toContainEqual(["HEX", "#ff0000"]);
    expect(rows).toContainEqual(["HSL", "hsl(0, 100%, 50%)"]);

    await type(container.querySelector<HTMLInputElement>("#fg-input")!, "#000000");
    await type(container.querySelector<HTMLInputElement>("#bg-input")!, "#ffffff");
    expect(container.textContent).toContain("21.00 : 1");
    expect(container.textContent).toContain("AAA Normal (7:1): Pass");
  });

  it("shows an error for an invalid color", async () => {
    await mount("#/color-converter");
    await type(await waitFor(() => container.querySelector<HTMLInputElement>("#color-input")), "notacolor");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unrecognized color");
  });
});


const button = (label: string) => waitFor(() => [...container.querySelectorAll("button")].find((b) => b.textContent === label));
const click = async (label: string) => {
  const el = await button(label);
  await act(async () => el.click());
};

describe("json <-> yaml tool", () => {
  it("converts both ways, swaps and shows JSON errors", async () => {
    await mount("#/json-yaml");
    await type(await textarea("JSON"), '{"a":[1,2],"b":{"c":true}}');
    expect((await textarea("YAML")).value).toBe("a:\n  - 1\n  - 2\nb:\n  c: true\n");

    await click("Swap");
    expect((await textarea("YAML")).value).toBe("a:\n  - 1\n  - 2\nb:\n  c: true\n");
    expect((await textarea("JSON")).value).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}');

    await click("JSON → YAML");
    await type(await textarea("JSON"), "{nope");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid JSON");
  });
});

describe("json <-> csv tool", () => {
  it("converts an array of objects and back", async () => {
    await mount("#/json-csv");
    await type(await textarea("JSON"), '[{"id":1,"name":"Ann, Jr."},{"id":2,"name":"Bob"}]');
    expect((await textarea("CSV")).value).toBe('id,name\n1,"Ann, Jr."\n2,Bob');

    await click("CSV → JSON");
    await type(await textarea("CSV"), "a,b\n1,x\n");
    expect(JSON.parse((await textarea("JSON")).value)).toEqual([{ a: 1, b: "x" }]);
    await type(await textarea("CSV"), 'a,b\n1,"x\n');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("never closed");
  });
});

describe("json <-> xml tool", () => {
  it("converts both ways and reports malformed XML", async () => {
    await mount("#/json-xml");
    await type(await textarea("JSON"), '{"user":{"@id":"1","name":"Ann"}}');
    expect((await textarea("XML")).value).toBe('<user id="1">\n  <name>Ann</name>\n</user>');

    await click("XML → JSON");
    await type(await textarea("XML"), '<a x="1"><b>2</b></a>');
    expect(JSON.parse((await textarea("JSON")).value)).toEqual({ a: { "@x": "1", b: "2" } });
    await type(await textarea("XML"), "<a><b></a>");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid XML");
  });
});

describe("json <-> toml tool", () => {
  it("converts, and explains why null cannot be converted", async () => {
    await mount("#/json-toml");
    await type(await textarea("JSON"), '{"title":"x","owner":{"name":"Ann"}}');
    expect((await textarea("TOML")).value).toBe('title = "x"\n\n[owner]\nname = "Ann"\n');

    await type(await textarea("JSON"), '{"a":{"b":null}}');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('"a.b"');

    await click("TOML → JSON");
    await type(await textarea("TOML"), "a = 1\n[t]\nb = [1, 2]");
    expect(JSON.parse((await textarea("JSON")).value)).toEqual({ a: 1, t: { b: [1, 2] } });
  });
});

describe("json types tool", () => {
  it("generates TypeScript, Go and Zod from a sample", async () => {
    await mount("#/json-types");
    await type(await textarea("JSON sample"), '{"id":1,"tags":["a"],"owner":{"name":"Ann"}}');
    const ts = (await textarea("TypeScript")).value;
    expect(ts).toContain("export interface Root {");
    expect(ts).toContain("owner: Owner;");

    await click("Go struct");
    expect((await textarea("Go")).value).toMatch(/ID\s+int64\s+`json:"id"`/);

    await click("Zod");
    expect((await textarea("Zod schema")).value).toContain("export const RootSchema = z.object({");
  });
});

describe("json query tool", () => {
  it("runs JSONPath and jq queries", async () => {
    await mount("#/json-query");
    await type(await textarea("JSON"), '{"items":[{"n":"a","p":5},{"n":"b","p":12}]}');
    const query = await waitFor(() => container.querySelector<HTMLInputElement>("#json-query-input"));
    await type(query, "$.items[?@.p > 10].n");
    expect((await waitFor(() => findTextarea("Result (1 match)"))).value).toBe('[\n  "b"\n]');

    await click("jq");
    await type(container.querySelector<HTMLInputElement>("#json-query-input")!, ".items[] | select(.p < 10) | .n");
    expect((await waitFor(() => findTextarea("Result (1 match)"))).value).toBe('"a"');

    await type(container.querySelector<HTMLInputElement>("#json-query-input")!, ".items | nope");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("nope/0 is not defined");
  });
});

describe("data validator tool", () => {
  it("formats YAML, XML and CSV and reports problems", async () => {
    await mount("#/data-validator");
    await type(await textarea("YAML"), "a:\n    - 1\n    - 2\n");
    expect((await textarea("Formatted")).value).toBe("a:\n  - 1\n  - 2\n");
    expect(container.querySelector(".status")?.textContent).toContain("Valid YAML");

    await click("XML");
    await type(await textarea("XML"), "<a><b>1</b></a>");
    expect((await textarea("Formatted")).value).toBe("<a>\n  <b>1</b>\n</a>\n");

    await click("CSV");
    await type(await textarea("CSV"), "a;b;c\n1;2\n");
    expect(container.textContent).toContain("Line 2: 2 fields, the first row has 3.");
    expect((await textarea("Formatted")).value).toBe("a;b;c\n1;2\n");

    await type(await textarea("CSV"), 'a,b\n"1,2\n');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("never closed");
  });
});

describe("sql formatter tool", () => {
  it("formats SQL, switches options and reports parse errors", async () => {
    await mount("#/sql-formatter");
    await type(await textarea("SQL"), "select a,b from t where x=1 and y=2");
    expect((await textarea("Formatted SQL")).value).toBe("SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1\n  AND y = 2\n");
    expect(container.querySelector(".status")?.textContent).toContain("Formatted 1 statement");

    await type(await textarea("SQL"), "select 1; select 2");
    expect(container.querySelector(".status")?.textContent).toContain("Formatted 2 statements");

    await type(await textarea("SQL"), "select 'abc from t");
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/line 1 column 8/);
  });
});

describe("markdown preview tool", () => {
  it("renders into a sandboxed iframe, escapes raw HTML and shows the HTML source", async () => {
    await mount("#/markdown-preview");
    await type(await textarea("Markdown"), "# Hi\n\n**bold** <b>raw</b> [x](javascript:alert(1))");
    const frame = await waitFor(() => container.querySelector<HTMLIFrameElement>('iframe[title="Markdown preview"]'));
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc).toContain("<h1>Hi</h1>");
    expect(doc).toContain("<strong>bold</strong>");
    expect(doc).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(doc).not.toContain("javascript:");
    expect(doc).toContain("default-src 'none'");
    expect(container.querySelector(".status")?.textContent).toContain("words");

    await click("HTML");
    expect((await textarea("HTML")).value).toContain("<h1>Hi</h1>");
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("code beautifier tool", () => {
  it("beautifies, minifies and reports errors and size savings", async () => {
    await mount("#/code-beautifier");
    await type(await textarea("JavaScript"), "function f(a,b){return a+b}");
    await waitFor(() => (findTextarea("Beautified")?.value ?? "") !== "" && findTextarea("Beautified"));
    expect((await textarea("Beautified")).value).toBe("function f(a, b) {\n  return a + b\n}\n");

    await click("Minify");
    // the previous (beautified) output is still shown until the minifier finishes, so wait for the minified shape
    await waitFor(() => /^function f\(\w,\w\)\{/.test(findTextarea("Minified")?.value ?? ""));
    expect((await textarea("Minified")).value).toMatch(/^function f\(\w,\w\)\{return \w\+\w\}$/);
    expect(container.querySelector(".status")?.textContent).toMatch(/smaller|larger/);

    await type(await textarea("JavaScript"), "function ( {");
    await waitFor(() => container.querySelector('[role="alert"]'));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/line 1, column \d+/);

    await click("HTML");
    await type(await textarea("HTML"), "<div>\n  <p> a   b </p>\n</div>");
    await waitFor(() => findTextarea("Minified")?.value === "<div><p>a b</p></div>");
    expect((await textarea("Minified")).value).toBe("<div><p>a b</p></div>");
  });
});

describe("text diff tool", () => {
  it("shows a side-by-side diff with word highlights, a unified view, and identical texts", async () => {
    await mount("#/text-diff");
    await type(await textarea("Original"), "one\ntwo words here\nthree");
    await type(await textarea("Modified"), "one\ntwo other here\nthree\nfour");
    expect(container.querySelector(".status")?.textContent).toContain("+2 added · −1 removed · 1 changed · 2 unchanged");

    const marks = [...container.querySelectorAll(".text-diff mark")].map((m) => m.textContent);
    expect(marks).toEqual(["words", "other"]);
    expect(container.querySelectorAll(".text-diff tr").length).toBe(4);

    await click("Unified");
    const unified = container.querySelector(".text-diff-unified")?.textContent ?? "";
    expect(unified).toContain("-two words here");
    expect(unified).toContain("+two other here");
    expect(unified).toContain("+four");
    expect(unified).toContain("@@ -1,3 +1,4 @@");

    await type(await textarea("Modified"), "one\ntwo words here\nthree");
    expect(container.querySelector(".status")?.textContent).toContain("identical");
    expect(container.querySelector(".text-diff-wrap")).toBeNull();
  });
});

describe("base64 files tool", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

  it("decodes a data URI, detects the type and offers a download", async () => {
    await mount("#/base64-file");
    await click("Base64 → File");
    await type(await textarea("Base64 or data URI"), `data:image/jpeg;base64,${PNG}`);
    await waitFor(() => container.querySelector(".status")?.textContent?.includes("image/png"));
    expect(container.querySelector(".status")?.textContent).toContain("image/png");
    expect(container.textContent).toContain("says image/jpeg, but the bytes look like image/png");

    await type(await textarea("Base64 or data URI"), "aGVsbG8gd29ybGQ=");
    await waitFor(() => findTextarea("Text preview"));
    expect((await textarea("Text preview")).value).toBe("hello world");
    expect(container.querySelector(".status")?.textContent).toContain("text/plain");

    await type(await textarea("Base64 or data URI"), "###");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Invalid character");
  });

  it("encodes a dropped file as a data URI", async () => {
    await mount("#/base64-file");
    const input = await waitFor(() => container.querySelector<HTMLInputElement>('input[type="file"]'));
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    if (typeof file.arrayBuffer !== "function") {
      // Older DOM implementations lack Blob.arrayBuffer; the decode test above covers the UI either way.
      Object.defineProperty(file, "arrayBuffer", { value: async () => new TextEncoder().encode("hello").buffer });
    }
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((await textarea("Result")).value).toBe("data:text/plain;base64,aGVsbG8=");
    expect(container.querySelector(".status")?.textContent).toContain("hello.txt");

    const select = container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "img-tag");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((await textarea("Result")).value).toBe('<img src="data:text/plain;base64,aGVsbG8=" alt="">');
  });
});

describe("html entities tool", () => {
  it("encodes, decodes, swaps and flags invalid entities", async () => {
    await mount("#/html-entities");
    await type(await textarea("Text"), `<a href="x">Tom & 'Jerry'</a>`);
    expect((await textarea("Encoded")).value).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");

    await click("Swap");
    expect((await textarea("Decoded")).value).toBe(`<a href="x">Tom & 'Jerry'</a>`);

    await type(await textarea("Text with entities"), "caf&eacute; &bogus; &#169;");
    expect((await textarea("Decoded")).value).toBe("café &bogus; ©");
    expect(container.textContent).toContain("Not valid entities, left as written: &bogus;");
  });
});

describe("unicode escape tool", () => {
  it("escapes, unescapes and reports facts about the text", async () => {
    await mount("#/unicode-escape");
    await type(await textarea("Text"), "café 🐙");
    expect((await textarea("Escaped")).value).toBe("caf\\u00e9 \\ud83d\\udc19");
    expect(container.querySelector(".status")?.textContent).toContain("1 outside the BMP");

    await click("Swap");
    expect((await textarea("Text")).value).toBe("café 🐙");
    expect(container.querySelector(".status")?.textContent).toContain("3 escapes decoded"); // é plus the two halves of the emoji

    await type(await textarea("Escaped text"), "\\u{110000}");
    expect(container.textContent).toContain("beyond U+10FFFF");
  });
});

describe("text bytes tool", () => {
  it("converts text to hex and back, reports errors, and searches the ASCII table", async () => {
    await mount("#/text-bytes");
    await type(await textarea("Text"), "Hé🐙");
    expect((await textarea("Bytes")).value).toBe("48 c3 a9 f0 9f 90 99");
    expect(container.querySelector(".status")?.textContent).toContain("7 bytes · 3 characters");
    expect(container.querySelector('table[aria-label="Characters"]')?.textContent).toContain("F0 9F 90 99");

    await click("Binary");
    expect((await textarea("Bytes")).value.split(" ")[0]).toBe("01001000");

    await click("Bytes → text");
    await click("Hex");
    await type(await textarea("Bytes"), "0x48 0xc3 0xa9");
    expect((await textarea("Text")).value).toBe("Hé");
    await type(await textarea("Bytes"), "48 zz");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('"zz" is not a hex number');

    const find = container.querySelector<HTMLInputElement>('input[placeholder="65, 0x41, A, LF, tab"]')!;
    await type(find, "LF");
    const rows = [...container.querySelectorAll('table[aria-label="ASCII table"] tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Line feed");
  });
});

describe("base32 / base58 / punycode tool", () => {
  it("encodes and decodes each encoding and reports errors", async () => {
    await mount("#/base-encodings");
    await type(await textarea("Text"), "foobar");
    expect((await textarea("Base32")).value).toBe("MZXW6YTBOI======");

    await click("Base58");
    expect((await textarea("Base58")).value).toBe("t1Zv2yaZ");

    await click("Decode");
    await type(await textarea("Base58"), "t1Zv2yaZ");
    expect((await textarea("Text")).value).toBe("foobar");
    await type(await textarea("Base58"), "0OIl");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("leaves out 0, O, I and l");

    await click("Punycode");
    await click("Encode");
    await type(await textarea("Domain name"), "München.de");
    expect((await textarea("ASCII domain (xn--…)")).value).toBe("xn--mnchen-3ya.de");
    await click("Swap");
    expect((await textarea("Domain name")).value).toBe("münchen.de");
  });
});

describe("bits and bytes tool", () => {
  const setInput = async (selector: string, value: string) => type(await waitFor(() => container.querySelector<HTMLInputElement>(selector)), value);
  const rowValue = (label: string) =>
    [...container.querySelectorAll(".result-row")].find((r) => r.querySelector("dt")?.textContent === label)?.querySelector("code")?.textContent;

  it("shows two's complement, byte swaps and toggles bit flags", async () => {
    await mount("#/bit-tools");
    await waitFor(() => rowValue("Signed"));
    expect(rowValue("Signed")).toBe("-1");
    expect(rowValue("Unsigned")).toBe("255");
    expect(rowValue("Binary")).toBe("1111 1111");

    await setInput('input[placeholder="-1, 255, 0xFF, 0b1010"]', "300");
    await waitFor(() => container.textContent?.includes("does not fit in 8 bits"));
    expect(rowValue("Unsigned")).toBe("44");

    await click("Endianness");
    await waitFor(() => rowValue("Read as little endian"));
    expect(rowValue("Reversed (byte swap)")).toBe("78 56 34 12");
    expect(rowValue("Read as big endian")).toBe("305419896 (0x12345678)");
    expect(rowValue("Read as little endian")).toBe("2018915346 (0x78563412)");

    await click("Bit flags");
    await waitFor(() => rowValue("Flags set"));
    expect(rowValue("Flags set")).toBe("READ | EXEC");
    await click("WRITE");
    await waitFor(() => rowValue("Flags set")?.includes("WRITE"));
    expect(rowValue("Flags set")).toBe("READ | WRITE | EXEC");
    expect(rowValue("Decimal")).toBe("7");
    const bit3 = container.querySelector<HTMLButtonElement>('button[aria-label="Bit 3"]')!;
    await act(async () => bit3.click());
    await waitFor(() => rowValue("Decimal") === "15");
    expect(rowValue("Flags set")).toBe("READ | WRITE | EXEC | HIDDEN");
  });
});

describe("jwt sign and verify tool", () => {
  const TOKEN =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("signs the jwt.io example, verifies it, and rejects a wrong key", async () => {
    await mount("#/jwt-signer");
    await type(await textarea("Header (alg is set for you)"), '{"typ":"JWT"}');
    await type(await textarea("Payload (JSON claims)"), '{"sub":"1234567890","name":"John Doe","iat":1516239022}');
    await type(await textarea("Secret"), "your-256-bit-secret");
    const signedBox = await waitFor(() => findTextarea("Signed token"));
    await waitFor(() => findTextarea("Signed token")?.value === TOKEN);
    expect(signedBox.value === TOKEN || findTextarea("Signed token")?.value === TOKEN).toBe(true);

    await click("Verify this token");
    await waitFor(() => container.textContent?.includes("Signature is valid"));
    expect(container.textContent).toContain("✓ Signature is valid");
    expect((await textarea("Payload")).value).toContain("John Doe");

    await type(await textarea("Secret"), "wrong-secret");
    await waitFor(() => container.textContent?.includes("does NOT match"));
    expect(container.textContent).toContain("Payload (NOT verified)");
  });
});

describe("aes tool", () => {
  it("decrypts real openssl output, round-trips with a password, and shows wrong-password errors", async () => {
    await mount("#/aes-crypto");
    const method = await waitFor(() => [...container.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "openssl")));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(method, "openssl");
      method.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Decrypt");
    const password = await waitFor(() => container.querySelector<HTMLInputElement>('input[type="password"]'));
    await type(password, "secret");
    const iterations = container.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    await type(iterations, "10000");
    await type(await textarea("Encrypted text"), "U2FsdGVkX18GGvtMCQOzAyT+Xm1E0oh48nq7YCd4YFs=");
    await waitFor(() => findTextarea("Decrypted text")?.value === "hello world");
    expect((await textarea("Decrypted text")).value).toBe("hello world");

    await type(password, "wrong");
    await waitFor(() => container.querySelector('[role="alert"]'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("wrong password");

    // encrypt, then decrypt the result with the same settings
    await click("Encrypt");
    await type(password, "pw");
    await type(iterations, "1000");
    await type(await textarea("Text to encrypt"), "round trip");
    await waitFor(() => (findTextarea("Encrypted text")?.value ?? "").startsWith("U2FsdGVkX1"));
    const encrypted = (await textarea("Encrypted text")).value;
    await click("Decrypt");
    await type(await textarea("Encrypted text"), encrypted);
    await waitFor(() => findTextarea("Decrypted text")?.value === "round trip");
    expect((await textarea("Decrypted text")).value).toBe("round trip");
  });
});

describe("key generator tool", () => {
  it("generates a key pair and derives a PBKDF2 key matching a known vector", async () => {
    await mount("#/key-generator");
    await click("Generate key pair");
    await waitFor(() => findTextarea("Private key (PKCS#8 PEM)")?.value.startsWith("-----BEGIN PRIVATE KEY-----"));
    expect((await textarea("Public key (SPKI PEM)")).value).toContain("BEGIN PUBLIC KEY");
    expect(container.textContent).toContain("JWK thumbprint");

    await click("PBKDF2");
    const iterations = await waitFor(() => container.querySelector<HTMLInputElement>('input[aria-label="Iterations"]'));
    await type(iterations, "1");
    await type(container.querySelector<HTMLInputElement>('input[aria-label="Salt"]')!, "73616c74"); // "salt" as hex
    await type(await waitFor(() => container.querySelector<HTMLInputElement>('input[type="password"]')), "password");
    await waitFor(() => findTextarea("Derived key")?.value);
    expect((await textarea("Derived key")).value).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");

    await type(iterations, "0");
    await waitFor(() => container.querySelector('[role="alert"]'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Iterations");
  });
});
