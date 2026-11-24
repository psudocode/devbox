import { describe, expect, it } from "vitest";
import { formatBytes, matchesAccept } from "./files";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KiB"],
    [1536, "1.5 KiB"],
    [1024 * 1024, "1 MiB"],
    [150 * 1024 * 1024, "150 MiB"],
    [1024 ** 3 * 2.25, "2.3 GiB"],
    [1024 ** 5, "1024 TiB"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("returns a dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(Infinity)).toBe("—");
  });
});

describe("matchesAccept", () => {
  const json = { name: "Data.JSON", type: "application/json" };
  const png = { name: "a.png", type: "image/png" };

  it("accepts everything when accept is empty", () => {
    expect(matchesAccept(png, undefined)).toBe(true);
    expect(matchesAccept(png, "")).toBe(true);
    expect(matchesAccept(png, " , ")).toBe(true);
  });

  it("matches extensions case-insensitively", () => {
    expect(matchesAccept(json, ".json")).toBe(true);
    expect(matchesAccept(json, ".txt, .json")).toBe(true);
    expect(matchesAccept(png, ".json")).toBe(false);
  });

  it("matches exact MIME types and wildcards", () => {
    expect(matchesAccept(png, "image/png")).toBe(true);
    expect(matchesAccept(png, "image/*")).toBe(true);
    expect(matchesAccept(png, "image/jpeg")).toBe(false);
    expect(matchesAccept(json, "image/*")).toBe(false);
  });

  it("does not treat an extension rule as a substring match", () => {
    expect(matchesAccept({ name: "x.json.bak", type: "" }, ".json")).toBe(false);
  });
});
