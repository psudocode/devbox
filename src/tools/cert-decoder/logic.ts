/** Decode X.509 certificates, PKCS#10 CSRs, public keys (PEM) and SSH public keys. Read-only and client-side. */
import { bytesToBase64, base64ToBytes } from "../../lib/base64";
import { pemToDer } from "../../lib/pem";
import { digest } from "../hash-generator/logic";
import {
  Asn1Error,
  TAG,
  bitIsSet,
  bitLength,
  bitString,
  bytesToBigInt,
  children,
  decodeOid,
  decodeString,
  decodeTime,
  expect,
  integerBytes,
  isContext,
  isUniversal,
  parseDer,
  toColonHex,
  toHex,
  type Asn1Node,
} from "./asn1";

// ---------------------------------------------------------------- OID names

const OID_NAMES: Record<string, string> = {
  // Name attributes
  "2.5.4.3": "CN", "2.5.4.4": "SN", "2.5.4.5": "serialNumber", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST",
  "2.5.4.9": "street", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.12": "title", "2.5.4.42": "GN", "2.5.4.97": "organizationIdentifier",
  "1.2.840.113549.1.9.1": "emailAddress", "0.9.2342.19200300.100.1.25": "DC", "0.9.2342.19200300.100.1.1": "UID",
  "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC", "1.3.6.1.4.1.311.60.2.1.2": "jurisdictionST", "2.5.4.15": "businessCategory",
  // Signature algorithms
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption", "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption", "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption", "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1", "1.2.840.10045.4.3.2": "ecdsa-with-SHA256", "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512", "1.3.101.112": "Ed25519", "1.3.101.113": "Ed448",
  // Public key algorithms and curves
  "1.2.840.113549.1.1.1": "RSA", "1.2.840.10045.2.1": "EC", "1.3.101.110": "X25519", "1.3.101.111": "X448", "1.2.840.10040.4.1": "DSA",
  "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521", "1.3.132.0.10": "secp256k1",
  // Extensions
  "2.5.29.14": "Subject Key Identifier", "2.5.29.15": "Key Usage", "2.5.29.17": "Subject Alternative Name",
  "2.5.29.18": "Issuer Alternative Name", "2.5.29.19": "Basic Constraints", "2.5.29.30": "Name Constraints",
  "2.5.29.31": "CRL Distribution Points", "2.5.29.32": "Certificate Policies", "2.5.29.35": "Authority Key Identifier",
  "2.5.29.37": "Extended Key Usage", "1.3.6.1.5.5.7.1.1": "Authority Information Access",
  "1.3.6.1.4.1.11129.2.4.2": "Signed Certificate Timestamps", "1.3.6.1.5.5.7.1.24": "TLS Feature",
  "1.2.840.113549.1.9.14": "Extension Request", "1.2.840.113549.1.9.7": "Challenge Password",
  // Extended key usages
  "1.3.6.1.5.5.7.3.1": "TLS Web Server Authentication", "1.3.6.1.5.5.7.3.2": "TLS Web Client Authentication",
  "1.3.6.1.5.5.7.3.3": "Code Signing", "1.3.6.1.5.5.7.3.4": "Email Protection", "1.3.6.1.5.5.7.3.8": "Time Stamping",
  "1.3.6.1.5.5.7.3.9": "OCSP Signing", "2.5.29.37.0": "Any Extended Key Usage",
  // Access methods
  "1.3.6.1.5.5.7.48.1": "OCSP", "1.3.6.1.5.5.7.48.2": "CA Issuers",
  // Policies
  "2.23.140.1.2.1": "Domain Validated", "2.23.140.1.2.2": "Organization Validated", "2.23.140.1.2.3": "Individual Validated",
  "2.23.140.1.1": "Extended Validation", "2.5.29.32.0": "Any Policy",
};

export const oidName = (oid: string): string => OID_NAMES[oid] ?? oid;

// ---------------------------------------------------------------- model

export interface NameAttribute {
  oid: string;
  name: string;
  value: string;
}

export interface ExtensionInfo {
  oid: string;
  name: string;
  critical: boolean;
  /** Decoded lines. A single line with the raw size when the extension is not understood. */
  lines: string[];
}

export interface PublicKeyInfo {
  algorithm: string;
  /** "2048 bit, exponent 65537", "P-256", ... */
  detail: string;
  /** SHA-256 of the SubjectPublicKeyInfo DER, Base64 (the "pin-sha256" form). */
  spkiSha256: string;
}

export interface CertificateInfo {
  kind: "certificate";
  version: number;
  serialHex: string;
  signatureAlgorithm: string;
  issuer: NameAttribute[];
  subject: NameAttribute[];
  notBefore: string;
  notAfter: string;
  publicKey: PublicKeyInfo;
  extensions: ExtensionInfo[];
  selfSigned: boolean;
  fingerprints: { sha1: string; sha256: string };
}

export interface CsrInfo {
  kind: "csr";
  version: number;
  signatureAlgorithm: string;
  subject: NameAttribute[];
  publicKey: PublicKeyInfo;
  extensions: ExtensionInfo[];
}

export interface PublicKeyOnlyInfo {
  kind: "public-key";
  publicKey: PublicKeyInfo;
}

export interface SshKeyInfo {
  kind: "ssh";
  keyType: string;
  detail: string;
  comment: string;
  fingerprintSha256: string;
  fingerprintMd5: string;
}

export interface ErrorItem {
  kind: "error";
  label: string;
  error: string;
}

export type DecodedItem = CertificateInfo | CsrInfo | PublicKeyOnlyInfo | SshKeyInfo | ErrorItem;

// ---------------------------------------------------------------- DER helpers

function algorithmOid(node: Asn1Node): string {
  const seq = children(expect(node, TAG.SEQUENCE, "an AlgorithmIdentifier"));
  return decodeOid(expect(seq[0], TAG.OID, "an algorithm OID"));
}

export function decodeName(node: Asn1Node): NameAttribute[] {
  const out: NameAttribute[] = [];
  for (const rdn of children(expect(node, TAG.SEQUENCE, "a Name"))) {
    for (const atv of children(expect(rdn, TAG.SET, "a RelativeDistinguishedName"))) {
      const [typeNode, valueNode] = children(expect(atv, TAG.SEQUENCE, "an AttributeTypeAndValue"));
      const oid = decodeOid(typeNode);
      out.push({ oid, name: oidName(oid), value: decodeString(valueNode) });
    }
  }
  return out;
}

export function formatName(attrs: NameAttribute[]): string {
  return attrs.length === 0 ? "(empty)" : attrs.map((a) => `${a.name}=${a.value}`).join(", ");
}

function ipToString(b: Uint8Array): string {
  if (b.length === 4) return Array.from(b).join(".");
  if (b.length === 16) {
    const groups = Array.from({ length: 8 }, (_, i) => ((b[i * 2] << 8) | b[i * 2 + 1]).toString(16));
    // Compress the longest run of zero groups (length >= 2) into "::".
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < 8; ) {
      if (groups[i] !== "0") {
        i++;
        continue;
      }
      let j = i;
      while (j < 8 && groups[j] === "0") j++;
      if (j - i > bestLen) [bestStart, bestLen] = [i, j - i];
      i = j;
    }
    if (bestLen < 2) return groups.join(":");
    const head = groups.slice(0, bestStart).join(":");
    const tail = groups.slice(bestStart + bestLen).join(":");
    return `${head}::${tail}`;
  }
  // A CIDR constraint (address + mask) or something unexpected.
  return toHex(b);
}

function generalName(node: Asn1Node): string {
  if (node.tagClass !== 2) return toHex(node.raw);
  const text = () => Array.from(node.value, (b) => String.fromCharCode(b)).join("");
  switch (node.tag) {
    case 1:
      return `email:${text()}`;
    case 2:
      return `DNS:${text()}`;
    case 4: {
      const inner = node.constructed ? children(node)[0] : undefined;
      return `DirName:${inner ? formatName(decodeName(inner)) : ""}`;
    }
    case 6:
      return `URI:${text()}`;
    case 7:
      return `IP:${ipToString(node.value)}`;
    case 8:
      return `RegisteredID:${node.value.length ? decodeOid({ ...node, tagClass: 0, tag: TAG.OID }) : ""}`;
    case 0:
      return "otherName";
    default:
      return `[${node.tag}]`;
  }
}

const KEY_USAGE_NAMES = [
  "Digital Signature", "Non Repudiation", "Key Encipherment", "Data Encipherment", "Key Agreement",
  "Certificate Sign", "CRL Sign", "Encipher Only", "Decipher Only",
];

function uris(node: Asn1Node, out: string[] = []): string[] {
  if (isContext(node, 6) && !node.constructed) out.push(Array.from(node.value, (b) => String.fromCharCode(b)).join(""));
  if (node.constructed) for (const c of children(node)) uris(c, out);
  return out;
}

function decodeExtensionValue(oid: string, value: Uint8Array): string[] {
  const root = parseDer(value);
  switch (oid) {
    case "2.5.29.17":
    case "2.5.29.18":
      return children(root).map(generalName);
    case "2.5.29.19": {
      const kids = children(root);
      const isCa = kids.find((k) => isUniversal(k, TAG.BOOLEAN))?.value[0] === 0xff;
      const pathLen = kids.find((k) => isUniversal(k, TAG.INTEGER));
      return [`CA: ${isCa ? "TRUE" : "FALSE"}`, ...(pathLen ? [`Path length: ${bytesToBigInt(integerBytes(pathLen))}`] : [])];
    }
    case "2.5.29.15": {
      const { bytes } = bitString(root);
      const names = KEY_USAGE_NAMES.filter((_, i) => bitIsSet(bytes, i));
      return names.length ? names : ["(none)"];
    }
    case "2.5.29.37":
      return children(root).map((k) => {
        const o = decodeOid(k);
        return oidName(o) === o ? o : `${oidName(o)} (${o})`;
      });
    case "2.5.29.14":
      return [toColonHex(expect(root, TAG.OCTET_STRING, "a key identifier").value)];
    case "2.5.29.35": {
      const keyId = children(root).find((k) => isContext(k, 0));
      return keyId ? [`keyid: ${toColonHex(keyId.value)}`] : ["(no key identifier)"];
    }
    case "2.5.29.31":
      return uris(root).map((u) => `URI:${u}`);
    case "1.3.6.1.5.5.7.1.1":
      return children(root).map((entry) => {
        const [method, location] = children(entry);
        return `${oidName(decodeOid(method))} - ${generalName(location)}`;
      });
    case "2.5.29.32":
      return children(root).map((info) => {
        const o = decodeOid(children(info)[0]);
        return oidName(o) === o ? o : `${oidName(o)} (${o})`;
      });
    default:
      return [`${value.length} bytes (not decoded)`];
  }
}

export function decodeExtension(node: Asn1Node): ExtensionInfo {
  const kids = children(expect(node, TAG.SEQUENCE, "an Extension"));
  const oid = decodeOid(kids[0]);
  const critical = kids.length > 2 && isUniversal(kids[1], TAG.BOOLEAN) && kids[1].value[0] === 0xff;
  const valueNode = kids[kids.length - 1];
  const value = expect(valueNode, TAG.OCTET_STRING, "an extension value").value;
  let lines: string[];
  try {
    lines = decodeExtensionValue(oid, value);
  } catch {
    lines = [`${value.length} bytes (could not be decoded)`];
  }
  return { oid, name: oidName(oid), critical, lines };
}

// ---------------------------------------------------------------- public keys

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  return bytesToBase64(await digest("SHA-256", bytes));
}

export async function describePublicKey(spki: Asn1Node): Promise<PublicKeyInfo> {
  const [algNode, keyNode] = children(expect(spki, TAG.SEQUENCE, "a SubjectPublicKeyInfo"));
  const algKids = children(expect(algNode, TAG.SEQUENCE, "an AlgorithmIdentifier"));
  const oid = decodeOid(algKids[0]);
  const algorithm = oidName(oid);
  const key = bitString(keyNode).bytes;
  let detail = "";
  if (oid === "1.2.840.113549.1.1.1") {
    try {
      const [n, e] = children(parseDer(key));
      detail = `${bitLength(integerBytes(n))} bit, exponent ${bytesToBigInt(integerBytes(e))}`;
    } catch {
      detail = "RSA key (could not read modulus)";
    }
  } else if (oid === "1.2.840.10045.2.1") {
    const curve = algKids[1] && isUniversal(algKids[1], TAG.OID) ? decodeOid(algKids[1]) : "";
    detail = curve ? `curve ${oidName(curve)}` : "unknown curve";
  } else if (oid === "1.3.101.112" || oid === "1.3.101.110") {
    detail = `${key.length * 8} bit`;
  } else {
    detail = `${key.length} bytes`;
  }
  return { algorithm, detail, spkiSha256: await sha256Base64(spki.raw) };
}

// ---------------------------------------------------------------- certificate / CSR

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export async function decodeCertificate(der: Uint8Array): Promise<CertificateInfo> {
  const cert = children(expect(parseDer(der), TAG.SEQUENCE, "a Certificate"));
  const tbs = children(expect(cert[0], TAG.SEQUENCE, "the TBSCertificate"));
  let i = 0;
  let version = 1;
  if (isContext(tbs[0], 0)) {
    version = Number(bytesToBigInt(integerBytes(children(tbs[0])[0]))) + 1;
    i++;
  }
  const serial = integerBytes(tbs[i++]);
  const tbsSigAlg = algorithmOid(tbs[i++]);
  const issuerNode = tbs[i++];
  const [notBefore, notAfter] = children(expect(tbs[i++], TAG.SEQUENCE, "the validity period")).map(decodeTime);
  const subjectNode = tbs[i++];
  const publicKey = await describePublicKey(tbs[i++]);

  let extensions: ExtensionInfo[] = [];
  for (; i < tbs.length; i++) {
    if (isContext(tbs[i], 3)) {
      extensions = children(children(tbs[i])[0]).map(decodeExtension);
    }
  }
  return {
    kind: "certificate",
    version,
    serialHex: toColonHex(serial),
    signatureAlgorithm: oidName(tbsSigAlg),
    issuer: decodeName(issuerNode),
    subject: decodeName(subjectNode),
    notBefore,
    notAfter,
    publicKey,
    extensions,
    selfSigned: equalBytes(issuerNode.raw, subjectNode.raw),
    fingerprints: {
      sha1: toColonHex(await digest("SHA-1", der)),
      sha256: toColonHex(await digest("SHA-256", der)),
    },
  };
}

export async function decodeCsr(der: Uint8Array): Promise<CsrInfo> {
  const csr = children(expect(parseDer(der), TAG.SEQUENCE, "a CertificationRequest"));
  const info = children(expect(csr[0], TAG.SEQUENCE, "the CertificationRequestInfo"));
  const version = Number(bytesToBigInt(integerBytes(info[0]))) + 1;
  const subject = decodeName(info[1]);
  const publicKey = await describePublicKey(info[2]);
  let extensions: ExtensionInfo[] = [];
  const attrs = info.find((n) => isContext(n, 0));
  if (attrs) {
    for (const attr of children(attrs)) {
      const [typeNode, valuesNode] = children(attr);
      if (decodeOid(typeNode) === "1.2.840.113549.1.9.14") {
        extensions = children(children(valuesNode)[0]).map(decodeExtension);
      }
    }
  }
  return { kind: "csr", version, signatureAlgorithm: oidName(algorithmOid(csr[1])), subject, publicKey, extensions };
}

// ---------------------------------------------------------------- SSH public keys

class Reader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done() {
    return this.pos >= this.bytes.length;
  }
  string(): Uint8Array {
    if (this.pos + 4 > this.bytes.length) throw new Error("Truncated key data.");
    const len = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4).getUint32(0);
    this.pos += 4;
    if (this.pos + len > this.bytes.length) throw new Error("Truncated key data.");
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  text(): string {
    return new TextDecoder().decode(this.string());
  }
}

const SSH_TYPE = /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;
const ECDSA_BITS: Record<string, number> = { nistp256: 256, nistp384: 384, nistp521: 521 };

export async function decodeSshPublicKey(text: string): Promise<SshKeyInfo> {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("#"));
  if (!line) throw new Error("Paste an SSH public key, e.g. the contents of id_ed25519.pub.");
  const tokens = line.split(/\s+/);
  const typeIndex = tokens.findIndex((t) => SSH_TYPE.test(t));
  if (typeIndex === -1 || !tokens[typeIndex + 1]) {
    throw new Error('Not an SSH public key line. Expected "ssh-ed25519 AAAA… comment" (also ssh-rsa, ecdsa-sha2-nistp256/384/521, sk-…).');
  }
  const keyType = tokens[typeIndex];
  const comment = tokens.slice(typeIndex + 2).join(" ");
  const decoded = base64ToBytes(tokens[typeIndex + 1]);
  if (!decoded.ok) throw new Error(`The key is not valid Base64: ${decoded.error}`);
  const blob = decoded.bytes;

  const r = new Reader(blob);
  const embedded = r.text();
  if (embedded !== keyType) throw new Error(`The key says "${keyType}" but its data is "${embedded}".`);
  let detail: string;
  if (keyType === "ssh-rsa") {
    const e = r.string();
    const n = r.string();
    detail = `${bitLength(n)} bit, exponent ${bytesToBigInt(e)}`;
  } else if (keyType === "ssh-dss") {
    detail = `${bitLength(r.string())} bit`;
  } else if (keyType === "ssh-ed25519" || keyType === "sk-ssh-ed25519@openssh.com") {
    detail = `${r.string().length * 8} bit`;
  } else {
    const curve = r.text();
    detail = `curve ${curve} (${ECDSA_BITS[curve] ?? "?"} bit)`;
  }
  const sha256 = (await digest("SHA-256", blob)) as Uint8Array;
  const md5 = (await digest("MD5", blob)) as Uint8Array;
  return {
    kind: "ssh",
    keyType,
    detail,
    comment,
    fingerprintSha256: `SHA256:${bytesToBase64(sha256, { padding: false })}`,
    fingerprintMd5: `MD5:${toColonHex(md5, false)}`,
  };
}

// ---------------------------------------------------------------- entry point

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;
export const MAX_BLOCKS = 20;

const CERT_LABELS = ["CERTIFICATE", "X509 CERTIFICATE", "TRUSTED CERTIFICATE"];
const CSR_LABELS = ["CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST"];

const message = (e: unknown) => (e instanceof Asn1Error ? `Invalid DER data: ${e.message}` : e instanceof Error ? e.message : String(e));

export type DecodeResult = { ok: true; items: DecodedItem[] } | { ok: false; error: string };

/** Detect what was pasted (PEM blocks or an SSH public key) and decode every item. */
export async function decodeInput(text: string): Promise<DecodeResult> {
  const input = text.trim();
  if (input === "") return { ok: false, error: "Paste a PEM certificate, CSR or public key, or an SSH public key." };

  if (!input.includes("-----BEGIN")) {
    try {
      return { ok: true, items: [await decodeSshPublicKey(input)] };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }

  const blocks = [...input.matchAll(PEM_BLOCK)];
  if (blocks.length === 0) return { ok: false, error: 'Found "-----BEGIN" but no complete PEM block with a matching "-----END" line.' };
  const items: DecodedItem[] = [];
  for (const match of blocks.slice(0, MAX_BLOCKS)) {
    const label = match[1];
    if (/PRIVATE KEY/.test(label)) {
      items.push({
        kind: "error",
        label,
        error: "This is a private key. It was not decoded. Never paste private keys into a web page; paste the certificate or public key instead.",
      });
      continue;
    }
    const pem = pemToDer(match[0]);
    if (!pem.ok) {
      items.push({ kind: "error", label, error: pem.error });
      continue;
    }
    try {
      if (CERT_LABELS.includes(label)) items.push(await decodeCertificate(pem.der));
      else if (CSR_LABELS.includes(label)) items.push(await decodeCsr(pem.der));
      else if (label === "PUBLIC KEY") items.push({ kind: "public-key", publicKey: await describePublicKey(parseDer(pem.der)) });
      else items.push({ kind: "error", label, error: `"${label}" blocks are not supported.` });
    } catch (e) {
      items.push({ kind: "error", label, error: message(e) });
    }
  }
  if (blocks.length > MAX_BLOCKS) {
    items.push({ kind: "error", label: "", error: `Only the first ${MAX_BLOCKS} blocks are decoded (${blocks.length} found).` });
  }
  return { ok: true, items };
}

// ---------------------------------------------------------------- text output

export type ValidityState = "valid" | "expired" | "not-yet-valid";

export function validityStatus(notBefore: string, notAfter: string, nowMs: number): { state: ValidityState; days: number } {
  const from = Date.parse(notBefore);
  const to = Date.parse(notAfter);
  if (nowMs < from) return { state: "not-yet-valid", days: Math.ceil((from - nowMs) / 86_400_000) };
  if (nowMs > to) return { state: "expired", days: Math.floor((nowMs - to) / 86_400_000) };
  return { state: "valid", days: Math.floor((to - nowMs) / 86_400_000) };
}

function keyLines(k: PublicKeyInfo): string[] {
  return [`Public key: ${k.algorithm}${k.detail ? `, ${k.detail}` : ""}`, `SPKI SHA-256 (pin): ${k.spkiSha256}`];
}

function extensionLines(extensions: ExtensionInfo[]): string[] {
  if (extensions.length === 0) return [];
  const out = ["Extensions:"];
  for (const e of extensions) {
    out.push(`  ${e.name}${e.critical ? " (critical)" : ""}:`);
    for (const l of e.lines) out.push(`    ${l}`);
  }
  return out;
}

export function formatItem(item: DecodedItem, nowMs: number): string {
  switch (item.kind) {
    case "certificate": {
      const v = validityStatus(item.notBefore, item.notAfter, nowMs);
      const status =
        v.state === "valid"
          ? `valid, expires in ${v.days} day${v.days === 1 ? "" : "s"}`
          : v.state === "expired"
            ? `EXPIRED ${v.days} day${v.days === 1 ? "" : "s"} ago`
            : `NOT YET VALID, starts in ${v.days} day${v.days === 1 ? "" : "s"}`;
      return [
        "Certificate",
        `Subject: ${formatName(item.subject)}`,
        `Issuer: ${formatName(item.issuer)}${item.selfSigned ? " (self-signed)" : ""}`,
        `Valid from: ${item.notBefore}`,
        `Valid until: ${item.notAfter} (${status})`,
        `Serial: ${item.serialHex}`,
        `Version: ${item.version}`,
        `Signature algorithm: ${item.signatureAlgorithm}`,
        ...keyLines(item.publicKey),
        `SHA-1 fingerprint: ${item.fingerprints.sha1}`,
        `SHA-256 fingerprint: ${item.fingerprints.sha256}`,
        ...extensionLines(item.extensions),
      ].join("\n");
    }
    case "csr":
      return [
        "Certificate signing request (CSR)",
        `Subject: ${formatName(item.subject)}`,
        `Signature algorithm: ${item.signatureAlgorithm}`,
        ...keyLines(item.publicKey),
        ...(item.extensions.length ? extensionLines(item.extensions) : ["Requested extensions: none"]),
      ].join("\n");
    case "public-key":
      return ["Public key", ...keyLines(item.publicKey)].join("\n");
    case "ssh":
      return [
        "SSH public key",
        `Type: ${item.keyType}`,
        `Key: ${item.detail}`,
        `Comment: ${item.comment || "(none)"}`,
        `Fingerprint (SHA-256): ${item.fingerprintSha256}`,
        `Fingerprint (MD5): ${item.fingerprintMd5}`,
      ].join("\n");
    case "error":
      return `Error${item.label ? ` in "${item.label}" block` : ""}: ${item.error}`;
  }
}

export function formatResult(items: DecodedItem[], nowMs: number): string {
  return items.map((item, i) => (items.length > 1 ? `#${i + 1} ` : "") + formatItem(item, nowMs)).join("\n\n");
}
