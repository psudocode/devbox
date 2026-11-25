import { describe, expect, it } from "vitest";
import {
  bytesToText,
  decryptOpenSsl,
  decryptRaw,
  decryptWithPassword,
  encryptOpenSsl,
  encryptRaw,
  encryptWithPassword,
  randomBytes,
  textToBytes,
} from "./logic";

const text = (s: string) => new TextEncoder().encode(s);
const hex = (h: string) => Uint8Array.from(h.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
const toHex = (b: Uint8Array) => bytesToText(b, "hex");
const b64 = (s: string) => {
  const r = textToBytes(s, "base64");
  if (!r.ok) throw new Error(r.error);
  return r.bytes;
};
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as { error?: string }).error ?? "failed");
  return r as Extract<T, { ok: true }>;
};

describe("raw AES against known vectors", () => {
  it("AES-GCM matches the NIST test cases (empty and one block)", async () => {
    const key = new Uint8Array(16);
    const iv = new Uint8Array(12);
    expect(toHex(must(await encryptRaw({ mode: "gcm", key, iv, plaintext: new Uint8Array(0) })).bytes)).toBe("58e2fccefa7e3061367f1d57a4e7455a");
    expect(toHex(must(await encryptRaw({ mode: "gcm", key, iv, plaintext: new Uint8Array(16) })).bytes)).toBe(
      "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf",
    );
  });

  it("AES-CBC and AES-CTR match OpenSSL output", async () => {
    const key256 = hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const iv = hex("0f0e0d0c0b0a09080706050403020100");
    // openssl enc -aes-256-cbc -K … -iv … on "hello world\n"
    expect(bytesToText(must(await encryptRaw({ mode: "cbc", key: key256, iv, plaintext: text("hello world\n") })).bytes, "base64")).toBe("qLZq+R3pF/sVhIjXJdzBJw==");
    // openssl enc -aes-128-ctr on "hello world"
    const key128 = hex("000102030405060708090a0b0c0d0e0f");
    expect(toHex(must(await encryptRaw({ mode: "ctr", key: key128, iv, plaintext: text("hello world") })).bytes)).toBe("48cc95fedb6c2c87767398");
  });

  it("decrypts what it encrypts, for every mode and key size", async () => {
    for (const mode of ["gcm", "cbc", "ctr"] as const) {
      for (const size of [16, 24, 32]) {
        const key = randomBytes(size);
        const iv = randomBytes(mode === "gcm" ? 12 : 16);
        const plaintext = text("Héllo 🐙 — some longer text to span several blocks.");
        const encrypted = must(await encryptRaw({ mode, key, iv, plaintext }));
        const decrypted = must(await decryptRaw({ mode, key, iv, ciphertext: encrypted.bytes }));
        expect(toHex(decrypted.bytes), `${mode}/${size}`).toBe(toHex(plaintext));
      }
    }
  });

  it("authenticates GCM data and additional data", async () => {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const aad = text("header");
    const enc = must(await encryptRaw({ mode: "gcm", key, iv, plaintext: text("secret"), aad })).bytes;
    expect(must(await decryptRaw({ mode: "gcm", key, iv, ciphertext: enc, aad })).bytes).toEqual(text("secret"));
    expect(await decryptRaw({ mode: "gcm", key, iv, ciphertext: enc })).toMatchObject({ ok: false, error: expect.stringContaining("Decryption failed") });
    const flipped = Uint8Array.from(enc);
    flipped[0] ^= 1;
    expect(await decryptRaw({ mode: "gcm", key, iv, ciphertext: flipped, aad })).toMatchObject({ ok: false });
    expect(await decryptRaw({ mode: "gcm", key: randomBytes(32), iv, ciphertext: enc, aad })).toMatchObject({ ok: false });
  });

  it("explains bad key, IV and data lengths", async () => {
    const ok = { mode: "cbc" as const, key: randomBytes(16), iv: randomBytes(16) };
    expect(await encryptRaw({ ...ok, key: randomBytes(10), plaintext: text("x") })).toMatchObject({ ok: false, error: expect.stringContaining("16, 24 or 32 bytes") });
    expect(await encryptRaw({ ...ok, iv: randomBytes(12), plaintext: text("x") })).toMatchObject({ ok: false, error: expect.stringContaining("16-byte IV") });
    expect(await encryptRaw({ mode: "gcm", key: randomBytes(16), iv: new Uint8Array(0), plaintext: text("x") })).toMatchObject({ ok: false, error: expect.stringContaining("IV") });
    expect(await decryptRaw({ ...ok, ciphertext: randomBytes(17) })).toMatchObject({ ok: false, error: expect.stringContaining("multiple of 16") });
    expect(await decryptRaw({ mode: "gcm", key: randomBytes(16), iv: randomBytes(12), ciphertext: randomBytes(8) })).toMatchObject({ ok: false, error: expect.stringContaining("tag") });
  });
});

describe("password-based container", () => {
  const options = { mode: "gcm" as const, keyBits: 256 as const, iterations: 1000 };

  it("round-trips and starts with the magic bytes", async () => {
    const encrypted = must(await encryptWithPassword("correct horse", text("Héllo 🐙"), options)).bytes;
    expect(new TextDecoder().decode(encrypted.subarray(0, 4))).toBe("DVB1");
    const decrypted = must(await decryptWithPassword("correct horse", encrypted)).bytes;
    expect(new TextDecoder().decode(decrypted)).toBe("Héllo 🐙");
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = must(await encryptWithPassword("pw", text("same"), options)).bytes;
    const b = must(await encryptWithPassword("pw", text("same"), options)).bytes;
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("rejects a wrong password and detects changes to the header or body", async () => {
    const encrypted = must(await encryptWithPassword("pw", text("data"), options)).bytes;
    expect(await decryptWithPassword("nope", encrypted)).toMatchObject({ ok: false, error: expect.stringContaining("Decryption failed") });
    const body = Uint8Array.from(encrypted);
    body[body.length - 1] ^= 1;
    expect(await decryptWithPassword("pw", body)).toMatchObject({ ok: false });
    // changing the iteration count in the header makes GCM fail (it is authenticated), not just derive a different key
    const header = Uint8Array.from(encrypted);
    header[9] ^= 1;
    expect(await decryptWithPassword("pw", header)).toMatchObject({ ok: false });
  });

  it("works for CBC and CTR (which do not authenticate)", async () => {
    for (const mode of ["cbc", "ctr"] as const) {
      const encrypted = must(await encryptWithPassword("pw", text("some data"), { ...options, mode, keyBits: 128 })).bytes;
      expect(new TextDecoder().decode(must(await decryptWithPassword("pw", encrypted)).bytes), mode).toBe("some data");
    }
  });

  it("rejects bad input", async () => {
    expect(await encryptWithPassword("", text("x"), options)).toMatchObject({ ok: false, error: "Enter a password." });
    expect(await encryptWithPassword("pw", text("x"), { ...options, iterations: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("Iterations") });
    expect(await encryptWithPassword("pw", text("x"), { ...options, iterations: 99_999_999 })).toMatchObject({ ok: false });
    expect(await decryptWithPassword("pw", text("not ours at all"))).toMatchObject({ ok: false, error: expect.stringContaining("DVB1") });
    expect(await decryptWithPassword("pw", text("DVB1\x09\x20"))).toMatchObject({ ok: false, error: expect.stringContaining("damaged") });
    expect(await decryptWithPassword("", text("DVB1"))).toMatchObject({ ok: false });
  });
});

describe("OpenSSL compatibility", () => {
  const salt = hex("0102030405060708");

  it("produces the same ciphertext as `openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -S 0102030405060708`", async () => {
    const out = must(await encryptOpenSsl("secret", text("hello world"), { keyBits: 256, iterations: 10000 }, salt)).bytes;
    expect(toHex(out.subarray(0, 16))).toBe("53616c7465645f5f0102030405060708"); // "Salted__" + salt
    expect(bytesToText(out.subarray(16), "base64")).toBe("7q5wkTyTQ8Dg2IIGDuZVlQ==");
  });

  it("matches AES-128 with fewer iterations too", async () => {
    const out = must(await encryptOpenSsl("pw", text("hello world"), { keyBits: 128, iterations: 1000 }, hex("0a0b0c0d0e0f1011"))).bytes;
    expect(bytesToText(out.subarray(16), "base64")).toBe("1JGtjBglSnrd5AIhiY9ADQ==");
  });

  it("decrypts real openssl output (Base64 with the Salted__ header)", async () => {
    const a = must(await decryptOpenSsl("secret", b64("U2FsdGVkX18GGvtMCQOzAyT+Xm1E0oh48nq7YCd4YFs="), { keyBits: 256, iterations: 10000 })).bytes;
    expect(new TextDecoder().decode(a)).toBe("hello world");
    const b = must(await decryptOpenSsl("pässword", b64("U2FsdGVkX1+EuSCujXnPBXSLn6fy8F2B9sztZoD6kfY="), { keyBits: 128, iterations: 5000 })).bytes;
    expect(new TextDecoder().decode(b)).toBe("héllo 🐙");
  });

  it("round-trips with a random salt", async () => {
    const enc = must(await encryptOpenSsl("pw", text("round trip"), { keyBits: 192, iterations: 500 })).bytes;
    expect(new TextDecoder().decode(must(await decryptOpenSsl("pw", enc, { keyBits: 192, iterations: 500 })).bytes)).toBe("round trip");
  });

  it("explains wrong settings and wrong data", async () => {
    const enc = b64("U2FsdGVkX18GGvtMCQOzAyT+Xm1E0oh48nq7YCd4YFs=");
    expect(await decryptOpenSsl("wrong", enc, { keyBits: 256, iterations: 10000 })).toMatchObject({ ok: false, error: expect.stringContaining("wrong password") });
    expect(await decryptOpenSsl("secret", enc, { keyBits: 256, iterations: 9999 })).toMatchObject({ ok: false });
    expect(await decryptOpenSsl("secret", text("plain text, no header at all"), { keyBits: 256, iterations: 10000 })).toMatchObject({ ok: false, error: expect.stringContaining("Salted__") });
  });
});

describe("byte text formats", () => {
  it("converts hex and Base64 both ways", () => {
    const bytes = hex("00ff10");
    expect(bytesToText(bytes, "hex")).toBe("00ff10");
    expect(bytesToText(hex("fbff"), "base64")).toBe("+/8=");
    expect(bytesToText(hex("fbff"), "base64url")).toBe("-_8");
    expect(must(textToBytes("0x00:FF:10", "hex")).bytes).toEqual(bytes);
    expect(must(textToBytes("-_8", "base64")).bytes).toEqual(hex("fbff"));
    expect(textToBytes("abc", "hex", "key")).toMatchObject({ ok: false, error: "The key has an odd number of hex digits." });
    expect(textToBytes("zz", "hex")).toMatchObject({ ok: false });
    expect(textToBytes("###", "base64", "IV")).toMatchObject({ ok: false, error: expect.stringContaining("The IV is not valid Base64") });
  });
});
