import { describe, expect, it } from "vitest";
import { decodeText, encodeText } from "./logic";

const std = { urlSafe: false, padding: true };

describe("encodeText", () => {
  it("encodes ASCII and UTF-8", () => {
    expect(encodeText("hello", std)).toBe("aGVsbG8=");
    expect(encodeText("héllo 🐙", std)).toBe("aMOpbGxvIPCfkJk=");
    expect(encodeText("", std)).toBe("");
  });

  it("supports URL-safe and unpadded output", () => {
    // "???>>>" encodes to "Pz8/Pj4+" in the standard alphabet
    expect(encodeText("???>>>", std)).toBe("Pz8/Pj4+");
    expect(encodeText("???>>>", { urlSafe: true, padding: true })).toBe("Pz8_Pj4-");
    expect(encodeText("a", { urlSafe: false, padding: false })).toBe("YQ");
  });
});

describe("decodeText", () => {
  const text = (input: string) => {
    const r = decodeText(input);
    if (!r.ok) throw new Error(r.error);
    return r.text;
  };

  it("decodes UTF-8 text from either alphabet, padded or not", () => {
    expect(text("aMOpbGxvIPCfkJk=")).toBe("héllo 🐙");
    expect(text("aMOpbGxvIPCfkJk")).toBe("héllo 🐙");
    expect(text("Pz8_Pj4-")).toBe("???>>>");
    expect(text("Pz8/Pj4+")).toBe("???>>>");
  });

  it("round-trips arbitrary text", () => {
    const sample = "line1\nline2\ttab \u0000 null, 日本語, ñ, 🧪, \\ \" '";
    for (const urlSafe of [false, true]) {
      for (const padding of [false, true]) {
        expect(text(encodeText(sample, { urlSafe, padding }))).toBe(sample);
      }
    }
  });

  it("explains when the bytes are not text", () => {
    const result = decodeText("//4="); // bytes ff fe: not valid UTF-8
    expect(result).toEqual({
      ok: false,
      error: "Decoded 2 bytes, but they are not valid UTF-8 text (probably binary data).",
    });
  });

  it("passes through Base64 syntax errors", () => {
    const result = decodeText("not base64!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid character/);
  });

  it("decodes empty input to empty text", () => {
    expect(text("")).toBe("");
  });
});
