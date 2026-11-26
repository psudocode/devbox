import { describe, expect, it } from "vitest";
import {
  decodeCertificate,
  decodeCsr,
  decodeInput,
  decodeSshPublicKey,
  formatItem,
  formatName,
  formatResult,
  validityStatus,
  type CertificateInfo,
  type CsrInfo,
  type SshKeyInfo,
} from "./logic";
import { pemToDer } from "../../lib/pem";

// Fixtures were generated with openssl / ssh-keygen; the expected values come from those same tools.
const CERT_PEM = "-----BEGIN CERTIFICATE-----\nMIICfzCCAiWgAwIBAgIUXVdVVYv3N/jmdwALJGXd+hzYfsgwCgYIKoZIzj0EAwIw\nVzELMAkGA1UEBhMCSUQxFDASBgNVBAgMC0RLSSBKYWthcnRhMRQwEgYDVQQKDAtE\nZXZCb3ggVGVzdDEcMBoGA1UEAwwTdGVzdC5kZXZib3guZXhhbXBsZTAeFw0yNjEx\nMjYxMjI5NDlaFw0zNjExMjMxMjI5NDlaMFcxCzAJBgNVBAYTAklEMRQwEgYDVQQI\nDAtES0kgSmFrYXJ0YTEUMBIGA1UECgwLRGV2Qm94IFRlc3QxHDAaBgNVBAMME3Rl\nc3QuZGV2Ym94LmV4YW1wbGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR7/pE0\nqK2KdQhN0xulVEctX8zXYKUhIozldWAC21LgIbMKxlYNqNbM8efY6tR3p6850pmJ\nae4zPOEk0HuuyEF6o4HOMIHLMB0GA1UdDgQWBBR7z7RWyLujYZoa/fyMaVAofqj9\nNTAfBgNVHSMEGDAWgBR7z7RWyLujYZoa/fyMaVAofqj9NTBMBgNVHREERTBDghN0\nZXN0LmRldmJveC5leGFtcGxlghAqLmRldmJveC5leGFtcGxlhwTAAAIKgRRhZG1p\nbkBkZXZib3guZXhhbXBsZTAOBgNVHQ8BAf8EBAMCBaAwHQYDVR0lBBYwFAYIKwYB\nBQUHAwEGCCsGAQUFBwMCMAwGA1UdEwEB/wQCMAAwCgYIKoZIzj0EAwIDSAAwRQIh\nAKh2QsEZaAEsY525S+Jxzc6j225/rdZBmlpwUv2FueiUAiAePYbh9ajMuQueSmDQ\nj51zToWExhRaRaktDAIxnoEGPg==\n-----END CERTIFICATE-----\n";
const CSR_PEM = "-----BEGIN CERTIFICATE REQUEST-----\nMIICzTCCAbUCAQAwQDELMAkGA1UEBhMCSUQxFDASBgNVBAoMC0RldkJveCBUZXN0\nMRswGQYDVQQDDBJjc3IuZGV2Ym94LmV4YW1wbGUwggEiMA0GCSqGSIb3DQEBAQUA\nA4IBDwAwggEKAoIBAQDquIYL4KsH23cHxWbDPah8FYldl0G/G2KhZv/2OCtGMXO2\nU/vK/xDyGR9qkR/YC/RQUsJBsxkQw+iosaZEPKVkG8EzG0tMzPkn8vqyCrWPOjqM\nCgtrOxFRBfYCzAY++sUFIrbUgHuBz4yMe76ffUNEKAUMp2GULmteayAzBzU9NNQ7\nySxlmPQFIIaqpWHTqzWilKjUUDSGV26wSYL1Iu1XQVOzSWKvgqb08AdB+0O0NKAg\nUrksID00VKoTftALeXvljbjNR5VKWmIVE9Tdoo/fmILPEDEI3UeHCGqPOgdg/xwR\nulejmOghjK/WLBrSFhoE8Yfqb974nTzQ/BashAK/AgMBAAGgSDBGBgkqhkiG9w0B\nCQ4xOTA3MDUGA1UdEQQuMCyCEmNzci5kZXZib3guZXhhbXBsZYIWd3d3LmNzci5k\nZXZib3guZXhhbXBsZTANBgkqhkiG9w0BAQsFAAOCAQEAh/eA0JyeJk/Qi5t71C/o\n8z30UfktfveE+ZZc4SlX2ehKc1lkbJalsHkAwOkyLbyWVxbMI+V0a6KiYcX16fp1\n1zlPLF6sybGqs+1un+zNEMhvNDI6xoZQe5JWqfZ9COlokYRX8UWnZdYmxB6K1miY\nguWxWw+5SYdawNQCCxzAorBnu/0X7keXhvHMzVZYduCNAt+7nfqk5ZUhMI8s+DZb\nFu9O3YUeAD8kfPXWPeIFvtdWgPcPvNcRYDqn3fdLvWWBUJjqSe9jq7gRqZlrILMe\nKrf/RKT+mb/PIRZdvPXgfW3I59ROdG+/YBCbv6Qwx7Na3sMryDCt5mYCii5B8aRY\nRw==\n-----END CERTIFICATE REQUEST-----\n";
const PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEe/6RNKitinUITdMbpVRHLV/M12Cl\nISKM5XVgAttS4CGzCsZWDajWzPHn2OrUd6evOdKZiWnuMzzhJNB7rshBeg==\n-----END PUBLIC KEY-----\n";
const CERT_SHA1 = "93:E5:4C:56:89:A8:EA:41:15:14:9D:D8:5E:C6:66:EC:4F:A1:FA:68";
const CERT_SHA256 = "52:01:D9:C8:1E:5E:CA:D6:7A:BC:EB:22:A8:E8:92:E6:7E:2D:33:0F:4E:2F:C2:83:C0:50:99:B3:DF:F1:DA:E1";
const CERT_SERIAL = "5D:57:55:55:8B:F7:37:F8:E6:77:00:0B:24:65:DD:FA:1C:D8:7E:C8";
const CERT_SPKI_SHA256 = "HC6TPtVYZyTQL9nnNjVNh78J+nfMaiK7oPunUk1KgnI=";
const CSR_SPKI_SHA256 = "Oi1lg0UrjDGAgi7Hk1NfQ5ubAhPo8wcmwuP+c/js9LQ=";
const SSH = {
  "ed": {
    "line": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID+6DoW+PYXVYOSjEvysuQCvQK7HX83/M0eFoxrRfO04 test@devbox",
    "sha256": "SHA256:bsMfr20NwWAz1s/WMoCtdDogPcpEUTQ6TApVhcM+eNs",
    "md5": "MD5:6e:a4:aa:8e:5e:ab:df:44:f8:5c:d1:6a:84:f8:2b:7a"
  },
  "rsa_ssh": {
    "line": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCfhFejEVKUE7JBQgh/GqeEBW3V2R7eK5GwECjMtuOD0gv4+dz/pdwuZUPDBO4m2NjjPv8o/x7UWgLLO77xbdZSXRCVMNmva5AwrgBRfmPBFMqsC6s2123aw5FnD9R9BFsNEwHN9jMu1MVkDAM2W+551JoiBuy9NBz3WPuXBFBltIRZYdJkxDIdBupyL+o3uvegcWyqHZ9mh7NpJhmJUTlSBdYwu1gwXP/59BYpSRsCDHveSJxcM/Bk8f5MWvyMFq7mLlb45lZ8DW+mWqfrJi2l+iqBeXY9/JH5Jm+9WmKMNzUV3KpZuUJEmS8NqLq2kwkyYVeeq4QxKOjEpSniV4Ml rsa@devbox",
    "sha256": "SHA256:/lgkkcCpvT9PpOrrfSxlnSnkhHLXdBebdA+gyX799YA",
    "md5": "MD5:8a:f0:ee:52:10:0a:e0:02:79:8a:7f:93:a4:2c:ac:fe"
  },
  "ecdsa": {
    "line": "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBK3p8GAAN7LE+wrgyT/anqXfi4x9COJmtBdh0OQ2PfiU2WwAylN7gPiKdaREeYkk0R1G0/B54qSWR8rjscgwLrk= ec@devbox",
    "sha256": "SHA256:P3E552xuMWJyuSFuuc5FRAgRCApf5QVHy88QR/MLVMQ",
    "md5": "MD5:59:68:2c:ee:46:7d:26:1a:c8:df:9f:e9:0a:8a:4d:04"
  }
};

const der = (pem: string) => {
  const r = pemToDer(pem);
  if (!r.ok) throw new Error(r.error);
  return r.der;
};

describe("decodeCertificate", () => {
  let cert: CertificateInfo;
  it("decodes the basic fields", async () => {
    cert = await decodeCertificate(der(CERT_PEM));
    expect(cert.version).toBe(3);
    expect(formatName(cert.subject)).toBe("C=ID, ST=DKI Jakarta, O=DevBox Test, CN=test.devbox.example");
    expect(formatName(cert.issuer)).toBe(formatName(cert.subject));
    expect(cert.selfSigned).toBe(true);
    expect(cert.serialHex).toBe(CERT_SERIAL);
    expect(cert.signatureAlgorithm).toBe("ecdsa-with-SHA256");
  });

  it("reads validity dates", async () => {
    cert = await decodeCertificate(der(CERT_PEM));
    expect(cert.notBefore).toBe("2026-11-26T12:29:49.000Z");
    expect(cert.notAfter).toBe("2036-11-23T12:29:49.000Z");
  });

  it("matches openssl fingerprints and the SPKI pin", async () => {
    cert = await decodeCertificate(der(CERT_PEM));
    expect(cert.fingerprints.sha1).toBe(CERT_SHA1);
    expect(cert.fingerprints.sha256).toBe(CERT_SHA256);
    expect(cert.publicKey.spkiSha256).toBe(CERT_SPKI_SHA256);
    expect(cert.publicKey.algorithm).toBe("EC");
    expect(cert.publicKey.detail).toBe("curve P-256");
  });

  it("decodes the extensions", async () => {
    cert = await decodeCertificate(der(CERT_PEM));
    const byName = Object.fromEntries(cert.extensions.map((e) => [e.name, e]));
    expect(byName["Subject Alternative Name"].lines).toEqual([
      "DNS:test.devbox.example",
      "DNS:*.devbox.example",
      "IP:192.0.2.10",
      "email:admin@devbox.example",
    ]);
    expect(byName["Basic Constraints"].critical).toBe(true);
    expect(byName["Basic Constraints"].lines).toEqual(["CA: FALSE"]);
    expect(byName["Key Usage"].lines).toEqual(["Digital Signature", "Key Encipherment"]);
    expect(byName["Extended Key Usage"].lines.join(" ")).toMatch(/TLS Web Server Authentication/);
    expect(byName["Extended Key Usage"].lines.join(" ")).toMatch(/TLS Web Client Authentication/);
    expect(byName["Subject Key Identifier"].lines[0]).toMatch(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
  });

  it("rejects non-certificate DER", async () => {
    await expect(decodeCertificate(Uint8Array.from([0x05, 0x00]))).rejects.toThrow();
    await expect(decodeCertificate(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]))).rejects.toThrow();
  });
});

describe("decodeCsr", () => {
  it("decodes subject, key and requested SAN", async () => {
    const csr: CsrInfo = await decodeCsr(der(CSR_PEM));
    expect(formatName(csr.subject)).toBe("C=ID, O=DevBox Test, CN=csr.devbox.example");
    expect(csr.publicKey.algorithm).toBe("RSA");
    expect(csr.publicKey.detail).toBe("2048 bit, exponent 65537");
    expect(csr.publicKey.spkiSha256).toBe(CSR_SPKI_SHA256);
    expect(csr.signatureAlgorithm).toBe("sha256WithRSAEncryption");
    const san = csr.extensions.find((e) => e.name === "Subject Alternative Name");
    expect(san?.lines).toEqual(["DNS:csr.devbox.example", "DNS:www.csr.devbox.example"]);
  });
});

describe("decodeSshPublicKey", () => {
  it("matches ssh-keygen for ed25519", async () => {
    const k: SshKeyInfo = await decodeSshPublicKey(SSH.ed.line);
    expect(k.keyType).toBe("ssh-ed25519");
    expect(k.detail).toBe("256 bit");
    expect(k.comment).toBe("test@devbox");
    expect(k.fingerprintSha256).toBe(SSH.ed.sha256);
    expect(k.fingerprintMd5).toBe(SSH.ed.md5);
  });

  it("matches ssh-keygen for rsa", async () => {
    const k = await decodeSshPublicKey(SSH.rsa_ssh.line);
    expect(k.keyType).toBe("ssh-rsa");
    expect(k.detail).toBe("2048 bit, exponent 65537");
    expect(k.fingerprintSha256).toBe(SSH.rsa_ssh.sha256);
    expect(k.fingerprintMd5).toBe(SSH.rsa_ssh.md5);
  });

  it("matches ssh-keygen for ecdsa", async () => {
    const k = await decodeSshPublicKey(SSH.ecdsa.line);
    expect(k.keyType).toBe("ecdsa-sha2-nistp256");
    expect(k.detail).toBe("curve nistp256 (256 bit)");
    expect(k.fingerprintSha256).toBe(SSH.ecdsa.sha256);
    expect(k.fingerprintMd5).toBe(SSH.ecdsa.md5);
  });

  it("accepts authorized_keys options before the key and ignores comment lines", async () => {
    const k = await decodeSshPublicKey(`# my key\nfrom="10.0.0.0/8",no-pty ${SSH.ed.line}`);
    expect(k.fingerprintSha256).toBe(SSH.ed.sha256);
  });

  it("rejects bad input with a helpful message", async () => {
    await expect(decodeSshPublicKey("")).rejects.toThrow(/Paste an SSH public key/);
    await expect(decodeSshPublicKey("hello world")).rejects.toThrow(/Not an SSH public key/);
    await expect(decodeSshPublicKey("ssh-ed25519 !!!!")).rejects.toThrow(/Base64/);
    const [, blob] = SSH.ed.line.split(" ");
    await expect(decodeSshPublicKey(`ssh-rsa ${blob}`)).rejects.toThrow(/says "ssh-rsa"/);
    await expect(decodeSshPublicKey("ssh-ed25519 AAAA")).rejects.toThrow();
  });
});

describe("decodeInput", () => {
  it("decodes a chain of PEM blocks in order", async () => {
    const r = await decodeInput(`${CERT_PEM}\n${CSR_PEM}\n${PUBLIC_KEY_PEM}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items.map((i) => i.kind)).toEqual(["certificate", "csr", "public-key"]);
  });

  it("detects SSH keys without PEM markers", async () => {
    const r = await decodeInput(SSH.ed.line);
    expect(r.ok && r.items[0].kind).toBe("ssh");
  });

  it("refuses to decode private keys", async () => {
    const r = await decodeInput("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items[0].kind).toBe("error");
      expect(formatItem(r.items[0], 0)).toMatch(/private key/);
    }
  });

  it("reports unsupported labels, corrupt bodies and incomplete blocks per item", async () => {
    const unsupported = await decodeInput("-----BEGIN DH PARAMETERS-----\nAAAA\n-----END DH PARAMETERS-----");
    expect(unsupported.ok && formatItem(unsupported.items[0], 0)).toMatch(/not supported/);

    const corrupt = await decodeInput("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----");
    expect(corrupt.ok && corrupt.items[0].kind).toBe("error");

    const incomplete = await decodeInput("-----BEGIN CERTIFICATE-----\nAAAA");
    expect(incomplete.ok).toBe(false);
    expect((await decodeInput("   ")).ok).toBe(false);
  });
});

describe("output", () => {
  it("states expiry relative to now", () => {
    const day = 86_400_000;
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-02-01T00:00:00.000Z";
    expect(validityStatus(from, to, Date.parse(from) + 10 * day)).toEqual({ state: "valid", days: 21 });
    expect(validityStatus(from, to, Date.parse(to) + 3 * day)).toEqual({ state: "expired", days: 3 });
    expect(validityStatus(from, to, Date.parse(from) - day)).toEqual({ state: "not-yet-valid", days: 1 });
  });

  it("formats a certificate as readable text", async () => {
    const cert = await decodeCertificate(der(CERT_PEM));
    const text = formatItem(cert, Date.parse("2027-01-01T00:00:00Z"));
    expect(text).toMatch(/^Certificate\n/);
    expect(text).toMatch(/Subject: C=ID, ST=DKI Jakarta, O=DevBox Test, CN=test\.devbox\.example/);
    expect(text).toMatch(/\(self-signed\)/);
    expect(text).toMatch(/valid, expires in \d+ days/);
    expect(text).toContain(`SHA-256 fingerprint: ${CERT_SHA256}`);
    expect(text).toContain("    DNS:test.devbox.example");
    const expired = formatItem(cert, Date.parse("2040-01-01T00:00:00Z"));
    expect(expired).toMatch(/EXPIRED \d+ days ago/);
  });

  it("numbers items when there are several", async () => {
    const r = await decodeInput(`${CERT_PEM}\n${CSR_PEM}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = formatResult(r.items, 0);
      expect(text).toMatch(/^#1 Certificate/);
      expect(text).toMatch(/\n\n#2 Certificate signing request/);
    }
  });
});
