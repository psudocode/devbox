import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../../lib/base64";
import { cleanToken, decodeJwt, formatRelative, timeStatus, type DecodedJwt } from "./logic";

const b64url = (text: string) => bytesToBase64(new TextEncoder().encode(text), { urlSafe: true, padding: false });
const make = (header: unknown, payload: unknown, signature = "c2ln") =>
  `${b64url(typeof header === "string" ? header : JSON.stringify(header))}.${b64url(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  )}.${signature}`;

const decode = (token: string): DecodedJwt => {
  const r = decodeJwt(token);
  if (!r.ok) throw new Error(r.error);
  return r.jwt;
};
const fail = (token: string) => {
  const r = decodeJwt(token);
  if (r.ok) throw new Error("expected error");
  return r.error;
};

// The canonical jwt.io example token (HS256, secret "your-256-bit-secret").
const JWT_IO =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("decodeJwt", () => {
  it("decodes the jwt.io example", () => {
    const jwt = decode(JWT_IO);
    expect(jwt.header.object).toEqual({ alg: "HS256", typ: "JWT" });
    expect(jwt.payload.object).toEqual({ sub: "1234567890", name: "John Doe", iat: 1516239022 });
    expect(jwt.algorithm).toBe("HS256");
    expect(jwt.signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(jwt.signatureBytes).toBe(32);
    expect(jwt.warnings).toEqual([]);
    expect(jwt.timeClaims).toEqual([{ name: "iat", label: "Issued at", seconds: 1516239022, iso: "2018-01-18T01:30:22.000Z" }]);
    expect(jwt.header.pretty).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  });

  it("accepts Bearer prefixes, quotes and wrapped lines", () => {
    expect(cleanToken(`  Bearer ${JWT_IO}  `)).toBe(JWT_IO);
    expect(cleanToken(`Authorization: Bearer ${JWT_IO}`)).toBe(JWT_IO);
    expect(cleanToken(`"${JWT_IO}"`)).toBe(JWT_IO);
    expect(cleanToken(JWT_IO.replace(/\./g, ".\n"))).toBe(JWT_IO);
    expect(decode(`Bearer ${JWT_IO}`).algorithm).toBe("HS256");
  });

  it("handles unicode payloads", () => {
    const jwt = decode(make({ alg: "HS256" }, { name: "Ahmad Awdiyanto 🐙 日本" }));
    expect(jwt.payload.object?.name).toBe("Ahmad Awdiyanto 🐙 日本");
  });

  it("keeps big numbers exact in the pretty output", () => {
    const jwt = decode(make({ alg: "HS256" }, '{"id":12345678901234567890}'));
    expect(jwt.payload.pretty).toContain("12345678901234567890");
  });

  it("collects time claims in a stable order", () => {
    const jwt = decode(make({ alg: "HS256" }, { exp: 2000000000, nbf: 1700000000, iat: 1690000000.5 }));
    expect(jwt.timeClaims.map((c) => c.name)).toEqual(["iat", "nbf", "exp"]);
    expect(jwt.timeClaims[2].iso).toBe("2033-05-18T03:33:20.000Z");
  });

  it("warns about unsigned and unsigned-looking tokens", () => {
    expect(decode(make({ alg: "none" }, { a: 1 }, "")).warnings.join()).toContain('alg is "none"');
    expect(decode(make({ alg: "HS256" }, { a: 1 }, "")).warnings.join()).toContain("signature part is empty");
    expect(decode(make({ typ: "JWT" }, { a: 1 })).warnings.join()).toContain('no "alg"');
  });

  it("warns about bad time claims instead of failing", () => {
    const jwt = decode(make({ alg: "HS256" }, { exp: "tomorrow", nbf: 1e20 }));
    expect(jwt.timeClaims).toEqual([]);
    expect(jwt.warnings).toHaveLength(2);
    expect(jwt.warnings[0]).toContain('"nbf"');
    expect(jwt.warnings[1]).toContain('"exp"');
  });

  it("tolerates a non-object payload with a warning", () => {
    const jwt = decode(make({ alg: "HS256" }, "just text"));
    expect(jwt.payload.object).toBeNull();
    expect(jwt.payload.pretty).toBe("just text");
    expect(jwt.warnings.join()).toContain("payload is not a JSON object");
  });

  it("explains structural errors", () => {
    expect(fail("")).toBe("Paste a JWT");
    expect(fail("abc")).toMatch(/3 dot-separated parts .* has 1/);
    expect(fail("a.b.c.d")).toMatch(/has 4/);
    expect(fail(".e30.sig")).toBe("The header is empty");
    expect(fail("e30..sig")).toBe("The payload is empty");
    expect(fail("e30.!!!.sig")).toMatch(/payload is not valid Base64url/);
    expect(fail(`${b64url("{}")}.//4=.sig`)).toMatch(/payload is not valid UTF-8/);
  });
});

describe("timeStatus", () => {
  const claims = (o: { exp?: number; nbf?: number }) =>
    (["nbf", "exp"] as const).flatMap((name) =>
      o[name] === undefined ? [] : [{ name, label: name, seconds: o[name]!, iso: "" }],
    );
  const now = 1_000_000 * 1000;

  it("classifies tokens", () => {
    expect(timeStatus(claims({ exp: 999_999 }), now)).toBe("expired");
    expect(timeStatus(claims({ exp: 1_000_000 }), now)).toBe("expired"); // exp is exclusive
    expect(timeStatus(claims({ exp: 1_000_001 }), now)).toBe("valid");
    expect(timeStatus(claims({ nbf: 1_000_100, exp: 2_000_000 }), now)).toBe("not-yet-valid");
    expect(timeStatus(claims({ nbf: 900_000 }), now)).toBe("no-expiry");
    expect(timeStatus([], now)).toBe("no-expiry");
  });
});

describe("formatRelative", () => {
  const now = 1_000_000 * 1000;
  it.each([
    [1_000_000, "now"],
    [1_000_030, "in 30 seconds"],
    [999_999, "1 second ago"],
    [1_000_000 + 7200, "in 2 hours"],
    [1_000_000 - 90, "1 minute ago"],
    [1_000_000 + 3 * 86400, "in 3 days"],
    [1_000_000 - 40 * 86400, "1 month ago"],
    [1_000_000 + 800 * 86400, "in 2 years"],
  ])("%d -> %s", (target, expected) => {
    expect(formatRelative(target, now)).toBe(expected);
  });
});
