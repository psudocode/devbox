import { base64ToBytes, bytesToBase64 } from "./base64";

/** PEM <-> DER helpers shared by the key and certificate tools. */

export type PemResult = { ok: true; der: Uint8Array; label: string } | { ok: false; error: string };

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/;

/** Extract the first PEM block. Pass `labels` to accept only certain block types, e.g. ["PUBLIC KEY"]. */
export function pemToDer(pem: string, labels?: string[]): PemResult {
  const match = BLOCK.exec(pem.trim());
  if (!match) return { ok: false, error: 'Not a PEM block: expected "-----BEGIN …-----" and a matching "-----END …-----".' };
  const label = match[1];
  if (labels && !labels.includes(label)) {
    return { ok: false, error: `This is a "${label}" block; expected ${labels.map((l) => `"${l}"`).join(" or ")}.` };
  }
  // Headers such as "Proc-Type: 4,ENCRYPTED" mean the key is protected by a passphrase.
  if (/^[A-Za-z-]+:\s/m.test(match[2].trim())) {
    return { ok: false, error: "This PEM is encrypted (it has headers such as Proc-Type). Decrypt it first, e.g. with openssl." };
  }
  const decoded = base64ToBytes(match[2]);
  if (!decoded.ok) return { ok: false, error: `The PEM body is not valid Base64: ${decoded.error}` };
  return { ok: true, der: decoded.bytes, label };
}

/** Wrap DER bytes in a PEM block with 64-character lines. */
export function derToPem(der: Uint8Array, label: string): string {
  const body = bytesToBase64(der).replace(/(.{1,64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}
