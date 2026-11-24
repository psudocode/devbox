/**
 * URL percent-encoding.
 *  - component: encodeURIComponent semantics, for a single value (query parameter, path segment). Encodes / ? # & = etc.
 *  - uri: encodeURI semantics, for a whole URL. Keeps / ? # & = : @ and friends untouched.
 *  - form: application/x-www-form-urlencoded, like component but a space becomes "+".
 */
export type UrlMode = "component" | "uri" | "form";

export type Result = { ok: true; text: string } | { ok: false; error: string };

export const MODES: { id: UrlMode; label: string; hint: string }[] = [
  { id: "component", label: "Component", hint: "For one value (query parameter, path segment): also encodes / ? # & = :" },
  { id: "uri", label: "Full URL", hint: "For a whole URL: keeps / ? # & = : @ as they are" },
  { id: "form", label: "Form (+ for space)", hint: "application/x-www-form-urlencoded: like Component, but a space becomes +" },
];

export function encodeUrl(text: string, mode: UrlMode): Result {
  try {
    if (mode === "uri") return { ok: true, text: encodeURI(text) };
    const encoded = encodeURIComponent(text);
    return { ok: true, text: mode === "form" ? encoded.replace(/%20/g, "+") : encoded };
  } catch {
    return { ok: false, error: "The text contains an unpaired UTF-16 surrogate, which cannot be encoded as UTF-8." };
  }
}

export function decodeUrl(text: string, mode: UrlMode): Result {
  const input = mode === "form" ? text.replace(/\+/g, " ") : text;
  try {
    return { ok: true, text: mode === "uri" ? decodeURI(input) : decodeURIComponent(input) };
  } catch {
    // Explain which kind of problem it is: a broken escape, or bytes that are not UTF-8.
    const broken = /%(?![0-9a-fA-F]{2})/.exec(text);
    if (broken) {
      const shown = text.slice(broken.index, broken.index + 3);
      return { ok: false, error: `Invalid percent escape "${shown}" at position ${broken.index + 1} (expected % followed by 2 hex digits)` };
    }
    return { ok: false, error: "The percent-encoded bytes are not valid UTF-8." };
  }
}
