import { describe, expect, it } from "vitest";
import { base32Encode } from "../base-encodings/logic";
import {
  DEFAULT_PARAMS,
  buildOtpAuthUri,
  generateSecret,
  hotp,
  parseOtpAuthUri,
  parseSecret,
  timeCounter,
  totp,
  totpWindow,
  verifyTotp,
  type OtpAlgorithm,
} from "./logic";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("hotp (RFC 4226 Appendix D)", () => {
  const secret = ascii("12345678901234567890");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it.each(expected.map((code, counter) => [counter, code] as const))("counter %i -> %s", async (counter, code) => {
    expect(await hotp(secret, counter)).toBe(code);
  });

  it("rejects bad counters and digit counts", async () => {
    await expect(hotp(secret, -1)).rejects.toThrow(RangeError);
    await expect(hotp(secret, 1.5)).rejects.toThrow(RangeError);
    await expect(hotp(secret, 0, "SHA-1", 5)).rejects.toThrow(RangeError);
  });
});

describe("totp (RFC 6238 Appendix B, 8 digits)", () => {
  const secrets: Record<OtpAlgorithm, Uint8Array> = {
    "SHA-1": ascii("12345678901234567890"),
    "SHA-256": ascii("12345678901234567890123456789012"),
    "SHA-512": ascii("1234567890123456789012345678901234567890123456789012345678901234"),
  };
  const vectors: [number, OtpAlgorithm, string][] = [
    [59, "SHA-1", "94287082"],
    [59, "SHA-256", "46119246"],
    [59, "SHA-512", "90693936"],
    [1111111109, "SHA-1", "07081804"],
    [1111111109, "SHA-256", "68084774"],
    [1111111109, "SHA-512", "25091201"],
    [1111111111, "SHA-1", "14050471"],
    [1234567890, "SHA-1", "89005924"],
    [1234567890, "SHA-256", "91819424"],
    [1234567890, "SHA-512", "93441116"],
    [2000000000, "SHA-1", "69279037"],
    [20000000000, "SHA-1", "65353130"],
  ];
  it.each(vectors)("t=%i %s -> %s", async (seconds, algorithm, code) => {
    const result = await totp(secrets[algorithm], seconds * 1000, { algorithm, digits: 8, period: 30 });
    expect(result.code).toBe(code);
  });

  it("reports the time left in the current step", async () => {
    const secret = ascii("12345678901234567890");
    const at = await totp(secret, 59_000, DEFAULT_PARAMS);
    expect(at.counter).toBe(1);
    expect(at.secondsRemaining).toBe(1);
    const start = await totp(secret, 60_000, DEFAULT_PARAMS);
    expect(start.counter).toBe(2);
    expect(start.secondsRemaining).toBe(30);
    expect(start.fractionRemaining).toBe(1);
  });

  it("supports other periods", async () => {
    const secret = ascii("12345678901234567890");
    const a = await totp(secret, 100_000, { algorithm: "SHA-1", digits: 6, period: 60 });
    expect(a.counter).toBe(1);
    await expect(totp(secret, 0, { algorithm: "SHA-1", digits: 6, period: 0 })).rejects.toThrow(RangeError);
  });

  it("computes the time counter", () => {
    expect(timeCounter(59_999)).toBe(1);
    expect(timeCounter(60_000)).toBe(2);
    expect(timeCounter(120_000, 60)).toBe(2);
  });
});

describe("verify and window", () => {
  const secret = ascii("12345678901234567890");
  const params = { algorithm: "SHA-1" as const, digits: 8, period: 30 };

  it("accepts the current, previous and next codes within the window", async () => {
    // t=59 is step 1; step 0 code is 84755224, step 2 code is 37359152 (from the HOTP table, 8 digits).
    expect(await verifyTotp(secret, "94287082", 59_000, params, 1)).toBe(0);
    expect(await verifyTotp(secret, "84755224", 59_000, params, 1)).toBe(-1);
    expect(await verifyTotp(secret, "37359152", 59_000, params, 1)).toBe(1);
  });

  it("rejects codes outside the window or malformed", async () => {
    expect(await verifyTotp(secret, "37359152", 59_000, params, 0)).toBeNull();
    expect(await verifyTotp(secret, "abc", 59_000, params, 1)).toBeNull();
    expect(await verifyTotp(secret, "", 59_000, params, 1)).toBeNull();
  });

  it("ignores spaces in the typed code", async () => {
    expect(await verifyTotp(secret, "9428 7082", 59_000, params, 0)).toBe(0);
  });

  it("does not go below step 0", async () => {
    const list = await totpWindow(secret, 0, params, 2);
    expect(list.map((x) => x.offset)).toEqual([0, 1, 2]);
  });
});

describe("secrets", () => {
  it("parses secrets the way authenticator apps show them", () => {
    // The RFC 4226 test secret, built at runtime so no secret-looking literal sits in the source.
    const encoded = base32Encode(ascii("12345678901234567890"), "rfc4648", false);
    const a = parseSecret(encoded.match(/.{1,4}/g)!.join(" "));
    const b = parseSecret(encoded.toLowerCase());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(new TextDecoder().decode(a.bytes)).toBe("12345678901234567890");
      expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
    }
  });

  it("explains bad secrets", () => {
    expect(parseSecret("")).toEqual({ ok: false, error: "Enter a Base32 secret." });
    const bad = parseSecret("NOT*BASE32");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/not valid Base32/);
  });

  it("generates a 20-byte secret as 32 Base32 characters that parses back", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    const parsed = parseSecret(s);
    expect(parsed.ok && parsed.bytes.length).toBe(20);
    expect(generateSecret()).not.toBe(s);
  });
});

describe("otpauth URIs", () => {
  it("parses a typical TOTP URI", () => {
    const r = parseOtpAuthUri("otpauth://totp/Example:alice@example.com?secret=jbsw y3dp ehpk 3pxp&issuer=Example&algorithm=SHA256&digits=8&period=60");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        type: "totp",
        label: "Example:alice@example.com",
        issuer: "Example",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA-256",
        digits: 8,
        period: 60,
      });
    }
  });

  it("uses defaults and takes the issuer from the label", () => {
    const r = parseOtpAuthUri("otpauth://totp/ACME%20Co:bob?secret=JBSWY3DPEHPK3PXP");
    expect(r.ok && r.value).toMatchObject({ issuer: "ACME Co", algorithm: "SHA-1", digits: 6, period: 30 });
  });

  it("parses HOTP counters", () => {
    const r = parseOtpAuthUri("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=5");
    expect(r.ok && r.value).toMatchObject({ type: "hotp", counter: 5 });
  });

  it.each([
    ["nonsense", /Not a valid URI/],
    ["https://example.com", /otpauth/],
    ["otpauth://steam/x?secret=AAAA", /Unsupported type/],
    ["otpauth://totp/x", /no "secret"/],
    ["otpauth://totp/x?secret=AAAA&algorithm=MD5", /Unsupported algorithm/],
    ["otpauth://totp/x?secret=AAAA&digits=4", /Digits/],
    ["otpauth://totp/x?secret=AAAA&period=0", /Period/],
    ["otpauth://hotp/x?secret=AAAA&counter=-1", /Counter/],
  ])("rejects %s", (uri, message) => {
    const r = parseOtpAuthUri(uri);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("builds URIs that parse back to the same values", () => {
    const uri = buildOtpAuthUri({
      type: "totp",
      label: "alice@example.com",
      issuer: "My Site",
      secret: "jbsw y3dp",
      algorithm: "SHA-512",
      digits: 8,
      period: 45,
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\/My%20Site:alice%40example\.com\?/);
    const r = parseOtpAuthUri(uri);
    expect(r.ok && r.value).toMatchObject({
      type: "totp",
      issuer: "My Site",
      secret: "JBSWY3DP",
      algorithm: "SHA-512",
      digits: 8,
      period: 45,
    });
  });

  it("omits default parameters", () => {
    const uri = buildOtpAuthUri({ type: "totp", label: "a", issuer: "", secret: "JBSWY3DP" });
    expect(uri).toBe("otpauth://totp/a?secret=JBSWY3DP");
  });
});
