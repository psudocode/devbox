/** Pure color parsing, conversion (HEX, RGB, HSL, OKLCH) and WCAG 2.1 contrast math. */

export interface RgbaColor {
  /** Red in [0, 1]. */
  r: number;
  /** Green in [0, 1]. */
  g: number;
  /** Blue in [0, 1]. */
  b: number;
  /** Alpha in [0, 1]. */
  a: number;
}

export interface ParsedColor {
  color: RgbaColor;
  /** True when the input was outside the sRGB gamut and had to be clamped. */
  clamped: boolean;
}

export type ParseColorResult = { ok: true; value: ParsedColor } | { ok: false; error: string };

export interface FormattedColors {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
}

export interface ContrastResult {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const roundTo = (n: number, decimals: number): number => {
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function parseAlpha(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const s = raw.trim();
  if (s.endsWith("%")) {
    const v = Number(s.slice(0, -1));
    return Number.isFinite(v) ? clamp01(v / 100) : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? clamp01(v) : null;
}

function parseAngle(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (s.endsWith("deg")) {
    const v = Number(s.slice(0, -3));
    return Number.isFinite(v) ? ((v % 360) + 360) % 360 : null;
  }
  if (s.endsWith("turn")) {
    const v = Number(s.slice(0, -4));
    return Number.isFinite(v) ? (((v * 360) % 360) + 360) % 360 : null;
  }
  if (s.endsWith("rad")) {
    const v = Number(s.slice(0, -3));
    return Number.isFinite(v) ? ((((v * 180) / Math.PI) % 360) + 360) % 360 : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? ((v % 360) + 360) % 360 : null;
}

function parsePercentOrNumber(raw: string, maxIfNumber: number): number | null {
  const s = raw.trim();
  if (s.endsWith("%")) {
    const v = Number(s.slice(0, -1));
    return Number.isFinite(v) ? v / 100 : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v / maxIfNumber : null;
}

/** Split CSS function arguments supporting both comma and space/slash syntax. */
function splitCssArgs(inner: string): { parts: string[]; alpha: string | undefined } | null {
  const slashIdx = inner.indexOf("/");
  let main = inner;
  let alpha: string | undefined;
  if (slashIdx !== -1) {
    main = inner.slice(0, slashIdx);
    alpha = inner.slice(slashIdx + 1).trim();
    if (!alpha) return null;
  }
  const parts = main.includes(",") ? main.split(",").map((p) => p.trim()) : main.trim().split(/\s+/);
  if (parts.some((p) => p === "")) return null;
  if (parts.length === 4 && alpha === undefined) {
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  }
  if (parts.length !== 3) return null;
  return { parts, alpha };
}

export function srgbToLinear(c: number): number {
  const abs = Math.abs(c);
  if (abs <= 0.04045) return c / 12.92;
  return Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  const abs = Math.abs(c);
  if (abs <= 0.0031308) return 12.92 * c;
  return Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055);
}

export function hslToRgb(hDeg: number, s: number, l: number): [number, number, number] {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [clamp01(r1 + m), clamp01(g1 + m), clamp01(b1 + m)];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bLab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(a, bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-6 ? 0 : H];
}

export function oklchToRgb(L: number, C: number, hDeg: number): { r: number; g: number; b: number; clamped: boolean } {
  const rad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const bLab = C * Math.sin(rad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bLab;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bLab;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bLab;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const sr = linearToSrgb(lr);
  const sg = linearToSrgb(lg);
  const sb = linearToSrgb(lb);

  const eps = 1e-4;
  const clamped = sr < -eps || sr > 1 + eps || sg < -eps || sg > 1 + eps || sb < -eps || sb > 1 + eps;
  return { r: clamp01(sr), g: clamp01(sg), b: clamp01(sb), clamped };
}

export function parseColor(raw: string): ParseColorResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: "Enter a color (HEX, rgb(), hsl(), or oklch())." };

  // HEX (#rgb, #rgba, #rrggbb, #rrggbbaa, or without #)
  const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input);
  if (hexMatch) {
    const h = hexMatch[1];
    const expand = (s: string) =>
      s.length <= 4 ? [...s].map((ch) => parseInt(ch + ch, 16) / 255) : s.match(/../g)!.map((p) => parseInt(p, 16) / 255);
    const [r, g, b, a = 1] = expand(h);
    return { ok: true, value: { color: { r, g, b, a }, clamped: false } };
  }

  const fnMatch = /^([a-z]+)\((.+)\)$/i.exec(input);
  if (!fnMatch) return { ok: false, error: `Unrecognized color format "${input}".` };

  const fn = fnMatch[1].toLowerCase();
  const parsedArgs = splitCssArgs(fnMatch[2]);
  if (!parsedArgs) return { ok: false, error: `Invalid arguments in ${fn}().` };

  const a = parseAlpha(parsedArgs.alpha);
  if (a === null) return { ok: false, error: `Invalid alpha value "${parsedArgs.alpha}".` };

  if (fn === "rgb" || fn === "rgba") {
    const [r, g, b] = parsedArgs.parts.map((p) => parsePercentOrNumber(p, 255));
    if (r === null || g === null || b === null) return { ok: false, error: "Invalid RGB channel value." };
    const clamped = r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1;
    return { ok: true, value: { color: { r: clamp01(r), g: clamp01(g), b: clamp01(b), a }, clamped } };
  }

  if (fn === "hsl" || fn === "hsla") {
    const h = parseAngle(parsedArgs.parts[0]);
    const s = parsePercentOrNumber(parsedArgs.parts[1], 100);
    const l = parsePercentOrNumber(parsedArgs.parts[2], 100);
    if (h === null || s === null || l === null) return { ok: false, error: "Invalid HSL value." };
    const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l));
    return { ok: true, value: { color: { r, g, b, a }, clamped: false } };
  }

  if (fn === "oklch") {
    const L = parsePercentOrNumber(parsedArgs.parts[0], 1);
    const C = parsePercentOrNumber(parsedArgs.parts[1], 1);
    const h = parseAngle(parsedArgs.parts[2]);
    if (L === null || C === null || h === null || C < 0) return { ok: false, error: "Invalid OKLCH value." };
    const { r, g, b, clamped } = oklchToRgb(clamp01(L), C, h);
    return { ok: true, value: { color: { r, g, b, a }, clamped } };
  }

  return { ok: false, error: `Unsupported color function "${fn}()".` };
}

export function formatHex(color: RgbaColor, includeAlpha = true): string {
  const toByte = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${toByte(color.r)}${toByte(color.g)}${toByte(color.b)}`;
  if (!includeAlpha || color.a >= 0.999) return base;
  return `${base}${toByte(color.a)}`;
}

export function formatColor(color: RgbaColor): FormattedColors {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const alpha = roundTo(color.a, 3);
  const hasAlpha = alpha < 1;

  const [h, s, l] = rgbToHsl(color.r, color.g, color.b);
  const [okL, okC, okH] = rgbToOklch(color.r, color.g, color.b);

  return {
    hex: formatHex(color, true),
    rgb: hasAlpha ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`,
    hsl: hasAlpha
      ? `hsla(${roundTo(h, 1)}, ${roundTo(s * 100, 1)}%, ${roundTo(l * 100, 1)}%, ${alpha})`
      : `hsl(${roundTo(h, 1)}, ${roundTo(s * 100, 1)}%, ${roundTo(l * 100, 1)}%)`,
    oklch: hasAlpha
      ? `oklch(${roundTo(okL, 3)} ${roundTo(okC, 3)} ${roundTo(okH, 1)} / ${alpha})`
      : `oklch(${roundTo(okL, 3)} ${roundTo(okC, 3)} ${roundTo(okH, 1)})`,
  };
}

function compositeOver(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

export function relativeLuminance(color: RgbaColor): number {
  return 0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b);
}

export function wcagContrast(fg: RgbaColor, bg: RgbaColor): ContrastResult {
  const opaqueBg = bg.a < 1 ? compositeOver(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const opaqueFg = fg.a < 1 ? compositeOver(fg, opaqueBg) : fg;
  const l1 = relativeLuminance(opaqueFg);
  const l2 = relativeLuminance(opaqueBg);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}
