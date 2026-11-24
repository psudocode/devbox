import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ALGORITHMS, digest, findMatch, formatDigest, hashAll, hmac, normalizeForCompare, toHex, utf8, type Algorithm } from "./logic";
import { md5 } from "./md5";

const hex = (bytes: Uint8Array) => toHex(bytes);
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
const repeat = (byte: number, n: number) => new Uint8Array(n).fill(byte);

describe("md5 (RFC 1321 test suite)", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    ["1234567890".repeat(8), "57edf4a22be3c955ac49da2e2107b67a"],
  ])("md5(%j)", (input, expected) => {
    expect(hex(md5(utf8(input)))).toBe(expected);
  });

  it("agrees with node:crypto for every length around the padding boundaries", () => {
    for (let len = 0; len <= 260; len++) {
      const data = new Uint8Array(randomBytes(len));
      expect(hex(md5(data)), `length ${len}`).toBe(createHash("md5").update(data).digest("hex"));
    }
  });

  it("handles a large input", () => {
    const data = new Uint8Array(randomBytes(1_000_000));
    expect(hex(md5(data))).toBe(createHash("md5").update(data).digest("hex"));
  });
});

describe("digest", () => {
  it("matches known SHA vectors for 'abc'", async () => {
    const abc = utf8("abc");
    expect(hex(await digest("SHA-1", abc))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hex(await digest("SHA-256", abc))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex(await digest("SHA-384", abc))).toBe(
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
    );
    expect(hex(await digest("SHA-512", abc))).toBe(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
    );
    expect(hex(await digest("MD5", abc))).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("hashes empty input", async () => {
    expect(hex(await digest("SHA-256", new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("hmac", () => {
  const hiThere = utf8("Hi There");

  it("matches RFC 2202 (MD5, SHA-1) test case 1", async () => {
    expect(hex(await hmac("MD5", repeat(0x0b, 16), hiThere))).toBe("9294727a3638bb1c13f48ef8158bfc9d");
    expect(hex(await hmac("SHA-1", repeat(0x0b, 20), hiThere))).toBe("b617318655057264e28bc0b6fb378c8ef146be00");
  });

  it("matches RFC 4231 (SHA-2) test case 1", async () => {
    const key = repeat(0x0b, 20);
    expect(hex(await hmac("SHA-256", key, hiThere))).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
    expect(hex(await hmac("SHA-384", key, hiThere))).toBe(
      "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6",
    );
    expect(hex(await hmac("SHA-512", key, hiThere))).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
  });

  it("matches RFC 4231 test case 6 (key longer than the block size)", async () => {
    const key = repeat(0xaa, 131);
    const data = utf8("Test Using Larger Than Block-Size Key - Hash Key First");
    expect(hex(await hmac("SHA-256", key, data))).toBe("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  });

  it("agrees with node:crypto for random keys and data, including empty keys", async () => {
    const algos: [Algorithm, string][] = [["MD5", "md5"], ["SHA-1", "sha1"], ["SHA-256", "sha256"], ["SHA-384", "sha384"], ["SHA-512", "sha512"]];
    for (const [algorithm, nodeName] of algos) {
      for (const keyLen of [0, 1, 20, 64, 65, 128, 129, 300]) {
        const key = new Uint8Array(randomBytes(keyLen));
        const data = new Uint8Array(randomBytes(keyLen + 17));
        expect(hex(await hmac(algorithm, key, data)), `${algorithm} key ${keyLen}`).toBe(
          createHmac(nodeName, key).update(data).digest("hex"),
        );
      }
    }
  });
});

describe("formatting", () => {
  it("formats hex, upper hex and base64", () => {
    const bytes = fromHex("00ff10ab");
    expect(formatDigest(bytes, "hex")).toBe("00ff10ab");
    expect(formatDigest(bytes, "HEX")).toBe("00FF10AB");
    expect(formatDigest(bytes, "base64")).toBe("AP8Qqw==");
  });
});

describe("hashAll / findMatch", () => {
  it("returns a row for each algorithm in order", async () => {
    const rows = await hashAll(utf8("abc"), "hex");
    expect(rows.map((r) => r.algorithm)).toEqual([...ALGORITHMS]);
    expect(rows[0].value).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("switches to HMAC when a key is given", async () => {
    const rows = await hashAll(utf8("Hi There"), "hex", repeat(0x0b, 20));
    expect(rows.find((r) => r.algorithm === "SHA-256")?.value).toBe("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  });

  it("finds a pasted hash regardless of case, spaces and colons", async () => {
    const rows = await hashAll(utf8("abc"), "hex");
    expect(findMatch(rows, "900150983CD24FB0D6963F7D28E17F72")).toBe("MD5");
    expect(findMatch(rows, " 90:01:50:98 3cd24fb0d6963f7d28e17f72 ")).toBe("MD5");
    expect(findMatch(rows, "a9993e364706816aba3e25717850c26c9cd0d89d")).toBe("SHA-1");
    expect(findMatch(rows, "deadbeef")).toBeNull();
    expect(findMatch(rows, "")).toBeNull();
  });

  it("matches Base64 output case-sensitively", async () => {
    const rows = await hashAll(utf8("abc"), "base64");
    const md5b64 = rows[0].value;
    expect(findMatch(rows, md5b64)).toBe("MD5");
    expect(findMatch(rows, md5b64.toLowerCase())).toBeNull();
  });

  it("normalizes only hex for comparison", () => {
    expect(normalizeForCompare("AB CD")).toBe("abcd");
    expect(normalizeForCompare("AbC+/=")).toBe("AbC+/=");
  });
});
