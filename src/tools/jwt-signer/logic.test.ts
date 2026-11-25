import { beforeAll, describe, expect, it } from "vitest";
import { derToPem } from "../../lib/pem";
import { ALGORITHMS, setClaim, signJwt, verifyJwt, type Algorithm } from "./logic";

const utf8: { secretEncoding: "utf8" } = { secretEncoding: "utf8" };
const NOW = Date.UTC(2026, 0, 1);

// The well-known jwt.io example.
const JWT_IO = {
  header: '{"alg":"HS256","typ":"JWT"}',
  payload: '{"sub":"1234567890","name":"John Doe","iat":1516239022}',
  secret: "your-256-bit-secret",
  token:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
};

interface KeyPair {
  privatePem: string;
  publicPem: string;
  privateJwk: string;
  publicJwk: string;
}

async function generate(algorithm: RsaHashedKeyGenParams | EcKeyGenParams): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privatePem: derToPem(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)), "PRIVATE KEY"),
    publicPem: derToPem(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)), "PUBLIC KEY"),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
    publicJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  };
}

let rsa: KeyPair;
const ec: Partial<Record<"P-256" | "P-384" | "P-521", KeyPair>> = {};

beforeAll(async () => {
  rsa = await generate({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" });
  for (const curve of ["P-256", "P-384", "P-521"] as const) ec[curve] = await generate({ name: "ECDSA", namedCurve: curve });
}, 60_000);

const keysFor = (alg: Algorithm) => {
  if (alg.startsWith("HS")) return { sign: "a-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef", verify: "a-secret-that-is-long-enough-for-hs512-signing-0123456789abcdef" };
  if (alg.startsWith("ES")) {
    const pair = ec[alg === "ES256" ? "P-256" : alg === "ES384" ? "P-384" : "P-521"]!;
    return { sign: pair.privatePem, verify: pair.publicPem };
  }
  return { sign: rsa.privatePem, verify: rsa.publicPem };
};

describe("HS256 against the jwt.io example", () => {
  it("produces the known token", async () => {
    const result = await signJwt({ header: JWT_IO.header, payload: JWT_IO.payload, alg: "HS256", key: JWT_IO.secret, options: utf8 });
    expect(result).toMatchObject({ ok: true, token: JWT_IO.token });
  });

  it("verifies the known token and rejects a wrong secret or a tampered payload", async () => {
    const good = await verifyJwt({ token: JWT_IO.token, alg: "HS256", key: JWT_IO.secret, options: utf8, nowMs: NOW });
    expect(good).toMatchObject({ ok: true, signatureValid: true, time: "no-expiry" });
    const wrong = await verifyJwt({ token: JWT_IO.token, alg: "HS256", key: "other-secret", options: utf8, nowMs: NOW });
    expect(wrong).toMatchObject({ ok: true, signatureValid: false });
    const [h, , s] = JWT_IO.token.split(".");
    const forgedPayload = btoa('{"sub":"1234567890","name":"Mallory","iat":1516239022}').replace(/=+$/, "");
    const tampered = await verifyJwt({ token: `${h}.${forgedPayload}.${s}`, alg: "HS256", key: JWT_IO.secret, options: utf8, nowMs: NOW });
    expect(tampered).toMatchObject({ ok: true, signatureValid: false });
  });

  it("reads a Base64 secret", async () => {
    const secret = btoa("your-256-bit-secret");
    const signed = await signJwt({ header: JWT_IO.header, payload: JWT_IO.payload, alg: "HS256", key: secret, options: { secretEncoding: "base64" } });
    expect(signed).toMatchObject({ ok: true, token: JWT_IO.token });
    expect(await signJwt({ header: "{}", payload: "{}", alg: "HS256", key: "***", options: { secretEncoding: "base64" } })).toMatchObject({ ok: false });
  });

  it("warns about short secrets", async () => {
    const short = await signJwt({ header: "{}", payload: "{}", alg: "HS512", key: "short", options: utf8 });
    expect(short).toMatchObject({ ok: true });
    if (short.ok) expect(short.warnings[0]).toMatch(/5 bytes.*at least 64/);
  });
});

describe("sign and verify with every algorithm", () => {
  for (const alg of ALGORITHMS) {
    it(`${alg}: round-trips, and fails for a different key`, async () => {
      const keys = keysFor(alg);
      const signed = await signJwt({ header: "{}", payload: '{"sub":"x","exp":4102444800}', alg, key: keys.sign, options: utf8 });
      expect(signed.ok, signed.ok ? "" : signed.error).toBe(true);
      if (!signed.ok) return;
      expect(signed.token.split(".")).toHaveLength(3);
      expect(JSON.parse(signed.header)).toEqual({ alg, typ: "JWT" });

      const verified = await verifyJwt({ token: signed.token, alg, key: keys.verify, options: utf8, nowMs: NOW });
      expect(verified).toMatchObject({ ok: true, signatureValid: true, time: "valid" });

      const otherKey = alg.startsWith("HS") ? "a-completely-different-secret-value-0000000000000000000000000" : alg.startsWith("ES") ? (await generate({ name: "ECDSA", namedCurve: alg === "ES256" ? "P-256" : alg === "ES384" ? "P-384" : "P-521" })).publicPem : (await generate({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" })).publicPem;
      const wrong = await verifyJwt({ token: signed.token, alg, key: otherKey, options: utf8, nowMs: NOW });
      expect(wrong).toMatchObject({ ok: true, signatureValid: false });
    }, 30_000);
  }

  it("accepts JWKs, and verifies with a private key by deriving the public half", async () => {
    const signed = await signJwt({ header: "{}", payload: "{}", alg: "RS256", key: rsa.privateJwk, options: utf8 });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(await verifyJwt({ token: signed.token, alg: "RS256", key: rsa.publicJwk, options: utf8, nowMs: NOW })).toMatchObject({ signatureValid: true });
    expect(await verifyJwt({ token: signed.token, alg: "RS256", key: rsa.privateJwk, options: utf8, nowMs: NOW })).toMatchObject({ signatureValid: true });
    expect(await verifyJwt({ token: signed.token, alg: "RS256", key: rsa.privatePem, options: utf8, nowMs: NOW })).toMatchObject({ signatureValid: true });
    const p256 = ec["P-256"]!;
    const es = await signJwt({ header: "{}", payload: "{}", alg: "ES256", key: p256.privateJwk, options: utf8 });
    expect(es.ok && (await verifyJwt({ token: es.token, alg: "ES256", key: p256.publicJwk, options: utf8, nowMs: NOW }))).toMatchObject({ signatureValid: true });
  });
});

describe("verification safety", () => {
  it("rejects alg none and algorithm mismatches", async () => {
    const none = `${btoa('{"alg":"none"}')}.${btoa('{"sub":"x"}')}.`.replace(/=/g, "");
    expect(await verifyJwt({ token: none, alg: "HS256", key: "k", options: utf8, nowMs: NOW })).toMatchObject({ ok: false, error: expect.stringContaining('"none"') });
    expect(await verifyJwt({ token: JWT_IO.token, alg: "RS256", key: rsa.publicPem, options: utf8, nowMs: NOW })).toMatchObject({
      ok: false,
      error: expect.stringContaining('says alg "HS256" but you chose RS256'),
    });
  });

  it("does not let an HS token be checked with a public key as the secret under another algorithm", async () => {
    // classic confusion attack: sign HS256 using the RSA public key text as the secret, then present it as RS256
    const forged = await signJwt({ header: "{}", payload: '{"admin":true}', alg: "HS256", key: rsa.publicPem, options: utf8 });
    expect(forged.ok).toBe(true);
    if (!forged.ok) return;
    const result = await verifyJwt({ token: forged.token, alg: "RS256", key: rsa.publicPem, options: utf8, nowMs: NOW });
    expect(result).toMatchObject({ ok: false });
  });

  it("flags expired and not-yet-valid tokens separately from the signature", async () => {
    const expired = await signJwt({ header: "{}", payload: `{"exp":${Math.floor(NOW / 1000) - 10}}`, alg: "HS256", key: JWT_IO.secret, options: utf8 });
    if (!expired.ok) throw new Error(expired.error);
    expect(await verifyJwt({ token: expired.token, alg: "HS256", key: JWT_IO.secret, options: utf8, nowMs: NOW })).toMatchObject({ signatureValid: true, time: "expired" });
    const early = await signJwt({ header: "{}", payload: `{"nbf":${Math.floor(NOW / 1000) + 3600}}`, alg: "HS256", key: JWT_IO.secret, options: utf8 });
    if (!early.ok) throw new Error(early.error);
    expect(await verifyJwt({ token: early.token, alg: "HS256", key: JWT_IO.secret, options: utf8, nowMs: NOW })).toMatchObject({ time: "not-yet-valid" });
  });

  it("rejects DER-encoded ECDSA signatures with an explanation", async () => {
    const p256 = ec["P-256"]!;
    const signed = await signJwt({ header: "{}", payload: "{}", alg: "ES256", key: p256.privatePem, options: utf8 });
    if (!signed.ok) throw new Error(signed.error);
    const [h, p] = signed.token.split(".");
    const result = await verifyJwt({ token: `${h}.${p}.${btoa("0".repeat(70)).replace(/=/g, "")}`, alg: "ES256", key: p256.publicPem, options: utf8, nowMs: NOW });
    expect(result).toMatchObject({ ok: true, signatureValid: false });
    if (result.ok) expect(result.warnings[0]).toMatch(/64 bytes/);
  });

  it("explains malformed tokens", async () => {
    expect(await verifyJwt({ token: "abc", alg: "HS256", key: "k", options: utf8, nowMs: NOW })).toMatchObject({ ok: false });
    expect(await verifyJwt({ token: `${JWT_IO.token.split(".").slice(0, 2).join(".")}.`, alg: "HS256", key: "k", options: utf8, nowMs: NOW })).toMatchObject({ ok: false });
  });
});

describe("key and input errors", () => {
  const sign = (alg: Algorithm, key: string) => signJwt({ header: "{}", payload: "{}", alg, key, options: utf8 });

  it("explains wrong or unsupported keys", async () => {
    expect(await sign("HS256", "  ")).toMatchObject({ ok: false, error: "Enter the secret." });
    expect(await sign("RS256", "")).toMatchObject({ ok: false });
    expect(await sign("RS256", "not a pem")).toMatchObject({ ok: false, error: expect.stringContaining("Not a PEM block") });
    expect(await sign("RS256", rsa.publicPem)).toMatchObject({ ok: false, error: expect.stringContaining("needs a private key") });
    expect(await sign("RS256", ec["P-256"]!.privatePem)).toMatchObject({ ok: false, error: expect.stringContaining("Could not read this PKCS#8 private key") });
    expect(await sign("ES384", ec["P-256"]!.privatePem)).toMatchObject({ ok: false, error: expect.stringContaining("curve") });
    expect(await sign("RS256", "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----")).toMatchObject({ ok: false, error: expect.stringContaining("openssl pkcs8") });
    expect(await sign("RS256", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")).toMatchObject({ ok: false, error: expect.stringContaining("not the certificate") });
    expect(await sign("ES256", "{ nope")).toMatchObject({ ok: false, error: expect.stringContaining("not valid JSON") });
    expect(await sign("ES256", rsa.privateJwk)).toMatchObject({ ok: false, error: expect.stringContaining('needs "EC"') });
    expect(await sign("ES384", ec["P-256"]!.privateJwk)).toMatchObject({ ok: false, error: expect.stringContaining("P-384") });
    expect(await sign("RS256", rsa.publicJwk)).toMatchObject({ ok: false, error: expect.stringContaining("no private part") });
  });

  it("validates the header and payload JSON, and overrides a mismatching alg", async () => {
    expect(await signJwt({ header: "{", payload: "{}", alg: "HS256", key: "k".repeat(32), options: utf8 })).toMatchObject({ ok: false, error: expect.stringContaining("header is not valid JSON") });
    expect(await signJwt({ header: "{}", payload: "[1]", alg: "HS256", key: "k".repeat(32), options: utf8 })).toMatchObject({ ok: false, error: "The payload must be a JSON object." });
    const result = await signJwt({ header: '{"alg":"none","kid":"k1"}', payload: "{}", alg: "HS256", key: "k".repeat(32), options: utf8 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(JSON.parse(result.header)).toEqual({ alg: "HS256", kid: "k1", typ: "JWT" });
      // alg first, then typ, then the rest
      expect(result.header).toBe('{"alg":"HS256","typ":"JWT","kid":"k1"}');
      expect(result.warnings[0]).toMatch(/replaced with "HS256"/);
    }
  });
});

describe("setClaim", () => {
  it("adds or replaces a numeric claim and keeps the rest", () => {
    expect(JSON.parse(setClaim('{"sub":"x"}', "exp", 1700000000.9))).toEqual({ sub: "x", exp: 1700000000 });
    expect(JSON.parse(setClaim('{"exp":1}', "exp", 2))).toEqual({ exp: 2 });
    expect(JSON.parse(setClaim("", "iat", 5))).toEqual({ iat: 5 });
    expect(setClaim("{broken", "iat", 5)).toBe("{broken");
  });
});
