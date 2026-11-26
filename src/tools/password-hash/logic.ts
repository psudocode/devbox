import { argon2d, argon2i, argon2id, argon2Verify, bcrypt, bcryptVerify } from "hash-wasm";

export type PasswordHashAlgorithm = "argon2id" | "argon2i" | "argon2d" | "bcrypt";

export interface BcryptParams {
  algorithm: "bcrypt";
  costFactor: number;
  salt?: Uint8Array;
}

export interface Argon2Params {
  algorithm: "argon2id" | "argon2i" | "argon2d";
  memorySize: number; // KiB
  iterations: number;
  parallelism: number;
  hashLength: number; // bytes
  salt?: Uint8Array;
}

export type HashParams = BcryptParams | Argon2Params;

export type HashResult =
  | {
      ok: true;
      hash: string;
      algorithm: PasswordHashAlgorithm;
      durationMs: number;
      warning?: string;
    }
  | { ok: false; error: string };

export type VerifyResult =
  | { ok: true; valid: boolean; algorithm: "bcrypt" | "argon2" }
  | { ok: false; error: string };

export interface InspectedHash {
  algorithm: string;
  details: { label: string; value: string }[];
}

export const DEFAULT_BCRYPT: BcryptParams = {
  algorithm: "bcrypt",
  costFactor: 10,
};

export const DEFAULT_ARGON2: Argon2Params = {
  algorithm: "argon2id",
  memorySize: 19456, // OWASP minimum ~19 MiB
  iterations: 2,
  parallelism: 1,
  hashLength: 32,
};

function randomSalt(bytes = 16): Uint8Array {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return buf;
}

/** Hash a password using bcrypt or Argon2 (WASM, 100% client-side). */
export async function hashPassword(password: string, params: HashParams): Promise<HashResult> {
  if (password === "") return { ok: false, error: "Enter a password to hash" };

  const start = performance.now();
  if (params.algorithm === "bcrypt") {
    const cost = Math.floor(params.costFactor);
    if (!Number.isFinite(cost) || cost < 4 || cost > 31) {
      return { ok: false, error: "bcrypt cost factor must be between 4 and 31" };
    }
    const salt = params.salt ?? randomSalt(16);
    if (salt.length !== 16) return { ok: false, error: "bcrypt salt must be 16 bytes" };

    const byteLen = new TextEncoder().encode(password).length;
    if (byteLen > 72) {
      return {
        ok: false,
        error: `bcrypt supports passwords up to 72 UTF-8 bytes (got ${byteLen}). Use Argon2id for longer passwords.`,
      };
    }

    const hash = await bcrypt({
      password,
      salt,
      costFactor: cost,
      outputType: "encoded",
    });
    return {
      ok: true,
      hash,
      algorithm: "bcrypt",
      durationMs: Math.round(performance.now() - start),
    };
  }

  const mem = Math.floor(params.memorySize);
  const iter = Math.floor(params.iterations);
  const par = Math.floor(params.parallelism);
  const len = Math.floor(params.hashLength);

  if (!Number.isFinite(mem) || mem < 8 || mem > 1048576) {
    return { ok: false, error: "Argon2 memory must be between 8 KiB and 1,048,576 KiB (1 GiB)" };
  }
  if (!Number.isFinite(iter) || iter < 1 || iter > 100) {
    return { ok: false, error: "Argon2 iterations must be between 1 and 100" };
  }
  if (!Number.isFinite(par) || par < 1 || par > 16) {
    return { ok: false, error: "Argon2 parallelism must be between 1 and 16" };
  }
  if (!Number.isFinite(len) || len < 4 || len > 128) {
    return { ok: false, error: "Argon2 hash length must be between 4 and 128 bytes" };
  }

  const salt = params.salt ?? randomSalt(16);
  const fn = params.algorithm === "argon2id" ? argon2id : params.algorithm === "argon2i" ? argon2i : argon2d;
  const hash = await fn({
    password,
    salt,
    memorySize: mem,
    iterations: iter,
    parallelism: par,
    hashLength: len,
    outputType: "encoded",
  });

  return {
    ok: true,
    hash,
    algorithm: params.algorithm,
    durationMs: Math.round(performance.now() - start),
  };
}

/** Verify a password against an encoded bcrypt ($2a$/$2b$/$2y$) or Argon2 ($argon2...) hash. */
export async function verifyPasswordHash(password: string, encodedHash: string): Promise<VerifyResult> {
  const hash = encodedHash.trim();
  if (password === "") return { ok: false, error: "Enter a password to verify" };
  if (hash === "") return { ok: false, error: "Enter an encoded bcrypt or Argon2 hash" };

  try {
    if (/^\$2[aby]\$\d{2}\$/.test(hash)) {
      const valid = await bcryptVerify({ password, hash });
      return { ok: true, valid, algorithm: "bcrypt" };
    }
    if (/^\$argon2(id|i|d)\$/.test(hash)) {
      const valid = await argon2Verify({ password, hash });
      return { ok: true, valid, algorithm: "argon2" };
    }
    return { ok: false, error: "Unrecognized hash format (expected $2a$/$2b$/$2y$ or $argon2id$/$argon2i$/$argon2d$)" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to verify hash" };
  }
}

/** Parse parameters from an encoded bcrypt or Argon2 PHC hash string without needing the password. */
export function inspectHash(encodedHash: string): InspectedHash | null {
  const hash = encodedHash.trim();
  const bcryptMatch = /^\$(2[aby])\$(\d{2})\$(.{22})(.{31})$/.exec(hash);
  if (bcryptMatch) {
    return {
      algorithm: `bcrypt ($${bcryptMatch[1]}$)`,
      details: [
        { label: "Cost factor", value: `${Number(bcryptMatch[2])} (2^${Number(bcryptMatch[2])} rounds)` },
        { label: "Salt (22 chars)", value: bcryptMatch[3] },
        { label: "Digest (31 chars)", value: bcryptMatch[4] },
      ],
    };
  }

  const argonMatch = /^\$(argon2(?:id|i|d))(?:\$v=(\d+))?\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(hash);
  if (argonMatch) {
    return {
      algorithm: argonMatch[1],
      details: [
        { label: "Version", value: argonMatch[2] ? `v=${argonMatch[2]}` : "19 (default)" },
        { label: "Memory", value: `${argonMatch[3]} KiB (${(Number(argonMatch[3]) / 1024).toFixed(2)} MiB)` },
        { label: "Iterations (time)", value: argonMatch[4] },
        { label: "Parallelism", value: argonMatch[5] },
        { label: "Salt (Base64)", value: argonMatch[6] },
        { label: "Digest (Base64)", value: argonMatch[7] },
      ],
    };
  }

  return null;
}
