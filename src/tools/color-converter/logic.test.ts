import { describe, expect, it } from "vitest";
import { formatColor, formatHex, parseColor, relativeLuminance, wcagContrast } from "./logic";

const mustParse = (input: string) => {
  const res = parseColor(input);
  if (!res.ok) throw new Error(res.error);
  return res.value;
};

describe("parseColor", () => {
  it("parses 3, 4, 6 and 8 digit hex with or without #", () => {
    expect(mustParse("#fff").color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(mustParse("3b82f6").color.b).toBeCloseTo(246 / 255, 5);
    expect(mustParse("#0000").color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    const eight = mustParse("#ff000080").color;
    expect(eight.r).toBe(1);
    expect(eight.a).toBeCloseTo(128 / 255, 5);
  });

  it("parses rgb/rgba in comma, space/slash and percentage syntax", () => {
    expect(mustParse("rgb(255, 0, 128)").color.g).toBe(0);
    expect(mustParse("rgba(255, 0, 0, 0.5)").color.a).toBe(0.5);
    expect(mustParse("rgb(100% 50% 0% / 25%)").color).toEqual({ r: 1, g: 0.5, b: 0, a: 0.25 });
  });

  it("parses hsl/hsla with deg, turn, rad or unitless", () => {
    const red = mustParse("hsl(0, 100%, 50%)").color;
    expect(red.r).toBeCloseTo(1, 5);
    expect(red.g).toBeCloseTo(0, 5);
    expect(mustParse("hsla(0.5turn 100% 50% / 0.4)").color.b).toBeCloseTo(1, 5);
    expect(mustParse("hsl(120deg, 100%, 50%)").color.g).toBeCloseTo(1, 5);
  });

  it("parses oklch and flags out-of-gamut colors", () => {
    const white = mustParse("oklch(1 0 0)");
    expect(white.clamped).toBe(false);
    expect(formatHex(white.color)).toBe("#ffffff");

    const wide = mustParse("oklch(70% 0.4 140 / 0.8)");
    expect(wide.clamped).toBe(true);
    expect(wide.color.a).toBe(0.8);
  });

  it("rejects invalid inputs", () => {
    expect(parseColor("").ok).toBe(false);
    expect(parseColor("#12345").ok).toBe(false);
    expect(parseColor("rgb(1, 2)").ok).toBe(false);
    expect(parseColor("cmyk(0, 0, 0, 1)").ok).toBe(false);
    expect(parseColor("oklch(0.5 -0.1 120)").ok).toBe(false);
  });
});

describe("formatColor", () => {
  it("formats HEX, RGB, HSL and OKLCH cleanly", () => {
    const formatted = formatColor(mustParse("#3b82f6").color);
    expect(formatted.hex).toBe("#3b82f6");
    expect(formatted.rgb).toBe("rgb(59, 130, 246)");
    expect(formatted.hsl).toBe("hsl(217.2, 91.2%, 59.8%)");
    expect(formatted.oklch).toMatch(/^oklch\(0\.623 0\.18[78] 259\.8\)$/);
  });

  it("includes alpha when translucent", () => {
    const formatted = formatColor(mustParse("rgba(10, 20, 30, 0.5)").color);
    expect(formatted.hex).toBe("#0a141e80");
    expect(formatted.rgb).toBe("rgba(10, 20, 30, 0.5)");
    expect(formatted.hsl).toContain("0.5)");
    expect(formatted.oklch).toContain("/ 0.5)");
  });
});

describe("wcagContrast", () => {
  it("computes 21:1 for black on white and 1:1 for identical colors", () => {
    const black = mustParse("#000000").color;
    const white = mustParse("#ffffff").color;
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBe(1);

    const max = wcagContrast(black, white);
    expect(max.ratio).toBeCloseTo(21, 5);
    expect(max.aaNormal && max.aaLarge && max.aaaNormal && max.aaaLarge).toBe(true);

    const same = wcagContrast(white, white);
    expect(same.ratio).toBe(1);
    expect(same.aaLarge).toBe(false);
  });

  it("evaluates AA vs AAA thresholds accurately", () => {
    const gray = mustParse("#767676").color;
    const white = mustParse("#ffffff").color;
    const res = wcagContrast(gray, white);
    expect(res.ratio).toBeGreaterThanOrEqual(4.5);
    expect(res.aaNormal).toBe(true);
    expect(res.aaaNormal).toBe(false);
  });

  it("composites translucent foreground over background", () => {
    const translucentBlack = mustParse("rgba(0, 0, 0, 0.5)").color;
    const white = mustParse("#ffffff").color;
    const res = wcagContrast(translucentBlack, white);
    expect(res.ratio).toBeGreaterThan(3);
    expect(res.ratio).toBeLessThan(6);
  });
});
