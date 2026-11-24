import { describe, expect, it } from "vitest";
import { decodeUrl, encodeUrl, type UrlMode } from "./logic";

const enc = (text: string, mode: UrlMode) => {
  const r = encodeUrl(text, mode);
  if (!r.ok) throw new Error(r.error);
  return r.text;
};
const dec = (text: string, mode: UrlMode) => {
  const r = decodeUrl(text, mode);
  if (!r.ok) throw new Error(r.error);
  return r.text;
};

describe("encodeUrl", () => {
  it("component mode encodes reserved characters", () => {
    expect(enc("a b&c=d/e?f#g", "component")).toBe("a%20b%26c%3Dd%2Fe%3Ff%23g");
    expect(enc("-_.!~*'()", "component")).toBe("-_.!~*'()");
  });

  it("uri mode keeps URL structure", () => {
    expect(enc("https://x.test/a b?q=1&r=é#frag", "uri")).toBe("https://x.test/a%20b?q=1&r=%C3%A9#frag");
  });

  it("form mode uses + for spaces but still encodes a literal +", () => {
    expect(enc("a b+c", "form")).toBe("a+b%2Bc");
  });

  it("encodes UTF-8 and emoji", () => {
    expect(enc("héllo 🐙", "component")).toBe("h%C3%A9llo%20%F0%9F%90%99");
  });

  it("reports unpaired surrogates instead of throwing", () => {
    const r = encodeUrl("bad \ud800 text", "component");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/surrogate/);
    expect(encodeUrl("bad \ud800", "uri").ok).toBe(false);
  });

  it("handles empty input", () => {
    expect(enc("", "component")).toBe("");
  });
});

describe("decodeUrl", () => {
  it("decodes component and form input", () => {
    expect(dec("a%20b%26c%2Bd+e", "component")).toBe("a b&c+d+e");
    expect(dec("a+b%2Bc", "form")).toBe("a b+c");
  });

  it("uri mode leaves reserved escapes alone", () => {
    expect(dec("https://x.test/a%20b%2Fc?q=%C3%A9", "uri")).toBe("https://x.test/a b%2Fc?q=é");
  });

  it("round-trips in every mode", () => {
    const sample = "a b+c&d=é/f?g#h 🐙 100%";
    for (const mode of ["component", "form"] as const) expect(dec(enc(sample, mode), mode)).toBe(sample);
    const url = "https://x.test/a b?q=é 🐙";
    expect(dec(enc(url, "uri"), "uri")).toBe(url);
  });

  it("points at a broken percent escape", () => {
    const r = decodeUrl("abc%zz", "component");
    expect(r).toEqual({ ok: false, error: 'Invalid percent escape "%zz" at position 4 (expected % followed by 2 hex digits)' });
    const lone = decodeUrl("100%", "component");
    expect(lone.ok).toBe(false);
    if (!lone.ok) expect(lone.error).toContain('"%" at position 4');
  });

  it("explains invalid UTF-8", () => {
    expect(decodeUrl("%FF%FE", "component")).toEqual({ ok: false, error: "The percent-encoded bytes are not valid UTF-8." });
  });
});
