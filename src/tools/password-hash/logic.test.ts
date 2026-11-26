import { describe, expect, it } from "vitest";
import { hashPassword, inspectHash, verifyPasswordHash } from "./logic";

const FIXED_SALT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

describe("hashPassword & verifyPasswordHash", () => {
  it("hashes and verifies bcrypt passwords", async () => {
    const res = await hashPassword("correct-horse-battery-staple", {
      algorithm: "bcrypt",
      costFactor: 4,
      salt: FIXED_SALT,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.hash.startsWith("$2a$04$") || res.hash.startsWith("$2b$04$")).toBe(true);

    const ok = await verifyPasswordHash("correct-horse-battery-staple", res.hash);
    expect(ok).toEqual({ ok: true, valid: true, algorithm: "bcrypt" });

    const bad = await verifyPasswordHash("wrong-password", res.hash);
    expect(bad).toEqual({ ok: true, valid: false, algorithm: "bcrypt" });
  });

  it("rejects bcrypt passwords exceeding 72 UTF-8 bytes", async () => {
    const longPw = "a".repeat(80);
    const res = await hashPassword(longPw, {
      algorithm: "bcrypt",
      costFactor: 4,
      salt: FIXED_SALT,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("72");
  });

  it("hashes and verifies argon2id, argon2i, and argon2d", async () => {
    for (const algorithm of ["argon2id", "argon2i", "argon2d"] as const) {
      const res = await hashPassword("hunter2", {
        algorithm,
        memorySize: 64,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
        salt: FIXED_SALT,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.hash.startsWith(`$${algorithm}$`)).toBe(true);

      const ok = await verifyPasswordHash("hunter2", res.hash);
      expect(ok).toEqual({ ok: true, valid: true, algorithm: "argon2" });

      const bad = await verifyPasswordHash("nope", res.hash);
      expect(bad).toEqual({ ok: true, valid: false, algorithm: "argon2" });
    }
  });

  it("rejects invalid inputs and unrecognized hash formats", async () => {
    expect((await hashPassword("", { algorithm: "bcrypt", costFactor: 10 })).ok).toBe(false);
    expect((await hashPassword("pw", { algorithm: "bcrypt", costFactor: 2 })).ok).toBe(false);
    expect((await verifyPasswordHash("pw", "$sha256$invalid")).ok).toBe(false);
  });
});

describe("inspectHash", () => {
  it("parses bcrypt and argon2id encoded strings", async () => {
    const bcryptRes = await hashPassword("test", { algorithm: "bcrypt", costFactor: 4, salt: FIXED_SALT });
    expect(bcryptRes.ok).toBe(true);
    if (bcryptRes.ok) {
      const info = inspectHash(bcryptRes.hash);
      expect(info?.algorithm).toContain("bcrypt");
      expect(info?.details[0].value).toContain("4");
    }

    const argonRes = await hashPassword("test", {
      algorithm: "argon2id",
      memorySize: 64,
      iterations: 2,
      parallelism: 1,
      hashLength: 32,
      salt: FIXED_SALT,
    });
    expect(argonRes.ok).toBe(true);
    if (argonRes.ok) {
      const info = inspectHash(argonRes.hash);
      expect(info?.algorithm).toBe("argon2id");
      expect(info?.details.some((d) => d.label === "Memory" && d.value.startsWith("64 KiB"))).toBe(true);
    }

    expect(inspectHash("not-a-hash")).toBeNull();
  });
});
