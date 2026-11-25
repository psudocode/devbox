import { describe, expect, it } from "vitest";
import { pemToDer } from "../../lib/pem";
import { derivePbkdf2, generateKeyPair, jwkThumbprint, RECOMMENDED_ITERATIONS, type KeyType } from "./logic";

const text = (s: string) => new TextEncoder().encode(s);
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function pbkdf2(hash: "SHA-1" | "SHA-256", iterations: number, length: number) {
  const r = await derivePbkdf2({ password: text("password"), salt: text("salt"), iterations, hash, length });
  if (!r.ok) throw new Error(r.error);
  return toHex(r.bytes);
}

describe("PBKDF2 test vectors", () => {
  it("matches RFC 6070 (HMAC-SHA1)", async () => {
    expect(await pbkdf2("SHA-1", 1, 20)).toBe("0c60c80f961f0e71f3a9b524af6012062fe037a6");
    expect(await pbkdf2("SHA-1", 2, 20)).toBe("ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957");
    expect(await pbkdf2("SHA-1", 4096, 20)).toBe("4b007901b765489abead49d926f721d065a429c1");
  });

  it("matches the common HMAC-SHA256 vectors", async () => {
    expect(await pbkdf2("SHA-256", 1, 32)).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
    expect(await pbkdf2("SHA-256", 2, 32)).toBe("ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
    expect(await pbkdf2("SHA-256", 4096, 32)).toBe("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
  });

  it("supports other lengths and hashes", async () => {
    expect((await pbkdf2("SHA-256", 1, 64)).length).toBe(128);
    expect((await pbkdf2("SHA-256", 1, 16)).length).toBe(32);
    const sha512 = await derivePbkdf2({ password: text("pw"), salt: text("s"), iterations: 10, hash: "SHA-512", length: 8 });
    expect(sha512.ok && sha512.bytes.length).toBe(8);
  });

  it("validates iterations and length", async () => {
    const base = { password: text("p"), salt: text("s"), hash: "SHA-256" as const };
    expect(await derivePbkdf2({ ...base, iterations: 0, length: 16 })).toMatchObject({ ok: false, error: expect.stringContaining("Iterations") });
    expect(await derivePbkdf2({ ...base, iterations: 1.5, length: 16 })).toMatchObject({ ok: false });
    expect(await derivePbkdf2({ ...base, iterations: 10_000_001, length: 16 })).toMatchObject({ ok: false });
    expect(await derivePbkdf2({ ...base, iterations: 1, length: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("length") });
    expect(await derivePbkdf2({ ...base, iterations: 1, length: 2000 })).toMatchObject({ ok: false });
  });

  it("lists recommended iteration counts", () => {
    expect(RECOMMENDED_ITERATIONS["SHA-256"]).toBe(600_000);
  });
});

describe("jwkThumbprint", () => {
  it("matches the RFC 7638 example", async () => {
    // RFC 7638 section 3.1
    // `kid` is not a required member, so it must not change the thumbprint (it is not in lib.dom's JsonWebKey type either).
    const jwk = {
      kty: "RSA",
      n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
      e: "AQAB",
      alg: "RS256",
      kid: "2011-04-29",
    } as JsonWebKey;
    expect(await jwkThumbprint(jwk)).toBe("NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs");
  });

  it("rejects unsupported key types", async () => {
    await expect(jwkThumbprint({ kty: "oct" })).rejects.toThrow(/Unsupported/);
  });
});

describe("generateKeyPair", () => {
  const types: KeyType[] = ["rsa-2048", "ec-p256", "ec-p384", "ec-p521", "ed25519"];

  for (const type of types) {
    it(`${type}: produces consistent PEMs, JWKs and fingerprints`, async () => {
      const result = await generateKeyPair(type);
      expect(result.ok, result.ok ? "" : result.error).toBe(true);
      if (!result.ok) return;
      const { pair } = result;

      expect(pair.privatePem.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
      expect(pair.publicPem.startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);
      expect(pair.privatePem.split("\n").every((l) => l.length <= 64 || l.startsWith("-----"))).toBe(true);
      expect(pemToDer(pair.privatePem, ["PRIVATE KEY"]).ok).toBe(true);
      const spki = pemToDer(pair.publicPem, ["PUBLIC KEY"]);
      expect(spki.ok).toBe(true);

      const priv = JSON.parse(pair.privateJwk) as JsonWebKey;
      const pub = JSON.parse(pair.publicJwk) as JsonWebKey;
      expect(priv.d).toBeTruthy();
      expect(pub.d).toBeUndefined();
      expect(priv.alg ?? pub.alg).toBeUndefined();
      expect(priv.key_ops).toBeUndefined();
      expect(await jwkThumbprint(pub)).toBe(pair.jwkThumbprint);
      expect(pair.spkiFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

      // The PEMs really are the same key pair: sign with the private one and verify with the public one.
      const privDer = pemToDer(pair.privatePem);
      if (spki.ok && privDer.ok) {
        const algorithm = type.startsWith("rsa") ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : type === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: pub.crv };
        const privKey = await crypto.subtle.importKey("pkcs8", privDer.der as BufferSource, algorithm, false, ["sign"]);
        const pubKey = await crypto.subtle.importKey("spki", spki.der as BufferSource, algorithm, false, ["verify"]);
        const signParams = type.startsWith("rsa") ? { name: "RSASSA-PKCS1-v1_5" } : type === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
        const sig = await crypto.subtle.sign(signParams, privKey, text("message"));
        expect(await crypto.subtle.verify(signParams, pubKey, sig, text("message"))).toBe(true);
        expect(await crypto.subtle.verify(signParams, pubKey, sig, text("other"))).toBe(false);
      }
    }, 30_000);
  }

  it("generates different keys each time", async () => {
    const a = await generateKeyPair("ec-p256");
    const b = await generateKeyPair("ec-p256");
    expect(a.ok && b.ok && a.pair.jwkThumbprint !== b.pair.jwkThumbprint).toBe(true);
  });

  it("uses the requested sizes", async () => {
    const rsa = await generateKeyPair("rsa-2048");
    if (!rsa.ok) throw new Error(rsa.error);
    // a 2048-bit modulus is 256 bytes -> ~342 Base64url characters
    expect((JSON.parse(rsa.pair.publicJwk) as JsonWebKey).n!.length).toBe(342);
    const ec = await generateKeyPair("ec-p384");
    if (!ec.ok) throw new Error(ec.error);
    expect((JSON.parse(ec.pair.publicJwk) as JsonWebKey).crv).toBe("P-384");
  }, 30_000);
});
